begin;

-- Curated source listings remain separate from reviewed/hosted repositories.
alter table app.external_catalog_items add column if not exists card_markdown text not null default ''
  check (octet_length(card_markdown) <= 100000);
alter table app.external_catalog_items drop constraint if exists external_catalog_items_provider_check;
alter table app.external_catalog_items add constraint external_catalog_items_provider_check
  check (provider in ('huggingface','google-drive','ollama'));
alter table app.external_catalog_items drop constraint if exists external_catalog_items_source_url_check;
alter table app.external_catalog_items add constraint external_catalog_items_source_url_check check (
  (provider='huggingface' and source_url ~ '^https://huggingface\.co/') or
  (provider='google-drive' and source_url ~ '^https://drive\.google\.com/(file/d/[A-Za-z0-9_-]{10,200}/view|drive/folders/[A-Za-z0-9_-]{10,200})(\?resourcekey=[A-Za-z0-9_-]{1,200})?$') or
  (provider='ollama' and provider_namespace='library' and provider_slug ~ '^[a-z0-9][a-z0-9._-]{0,99}$'
    and provider_repo_id='library/'||provider_slug and source_url='https://ollama.com/library/'||provider_slug)
);
-- The later curation migration owns this constraint once its flag exists.
-- Preserve curated HF rows when the full migration set is replayed.
do $revision_constraint$ begin
if not exists(select 1 from information_schema.columns where table_schema='app'
  and table_name='external_catalog_items' and column_name='is_curated') then
alter table app.external_catalog_items drop constraint if exists external_catalog_items_source_revision_check;
alter table app.external_catalog_items add constraint external_catalog_items_source_revision_check check (
  (provider='huggingface' and external_identity_id is not null and source_revision is not null and source_revision ~ '^[a-f0-9]{40,64}$') or
  (provider='google-drive' and external_identity_id is null and source_revision is null and owner_profile_id is not null and kind in ('model','dataset') and provider_downloads is null and provider_likes is null) or
  (provider='ollama' and external_identity_id is null and (source_revision is null or source_revision ~ '^[a-f0-9]{64}$')
    and kind='model' and provider_downloads is null and provider_likes is null)
);
end if;
end $revision_constraint$;
alter table app.external_catalog_items drop constraint if exists external_catalog_items_total_size_bytes_check;
alter table app.external_catalog_items add constraint external_catalog_items_total_size_bytes_check
  check (total_size_bytes >= 0 and total_size_bytes <= case when provider='ollama' then 2199023255552 else 21474836480 end);

create or replace function app.update_ollama_catalog_item(p_id uuid,p_title text,p_summary text,p_card text)
returns boolean language plpgsql volatile security definer set search_path=app,pg_catalog
as $$
declare item app.external_catalog_items;
begin
  if not app.context_is_verified() or app.current_profile_id() is null then
    raise exception 'authentication_required' using errcode='42501';
  end if;
  select * into item from app.external_catalog_items where id=p_id and provider='ollama' and status='active' for update;
  if not found or not (coalesce(item.owner_profile_id=app.current_profile_id(),false)
    or coalesce(app.can_access_organization(item.owner_organization_id,true),false)) then
    raise exception 'listing_not_owned' using errcode='42501';
  end if;
  if p_title is null or char_length(btrim(p_title)) not between 1 and 200
    or p_summary is null or char_length(p_summary)>2000
    or p_card is null or octet_length(p_card)>100000 then
    raise exception 'invalid_listing' using errcode='22023';
  end if;
  update app.external_catalog_items set title=btrim(p_title),summary=btrim(p_summary),card_markdown=p_card,
    source_metadata=source_metadata||jsonb_build_object('curator_edited',true),updated_at=now() where id=p_id;
  return true;
end $$;
revoke all on function app.update_ollama_catalog_item(uuid,text,text,text) from public,superii_web_backend,superii_payment_backend,superii_publishing_backend,superii_runtime_backend;
grant execute on function app.update_ollama_catalog_item(uuid,text,text,text) to superii_web_backend;

comment on table app.external_catalog_items is 'External source listings. Ollama entries credit upstream models; their curator owns only the listing. External files do not receive Super ii publication approval.';


-- Preserve the existing 100-card HF/Drive allowance independently of curated Ollama entries.
create or replace function app.link_external_catalog_item(
  p_external_identity_id uuid,
  p_owner_organization_id uuid,
  p_kind public.repository_kind,
  p_provider_repo_id text,
  p_source_revision text,
  p_source_url text,
  p_title text,
  p_summary text,
  p_license text,
  p_file_count integer,
  p_total_size_bytes bigint,
  p_source_metadata jsonb
)
returns uuid
language plpgsql volatile security definer
set search_path = app, pg_catalog
as $linked_work$
declare
  actor_profile uuid := app.current_profile_id();
  identity app.external_identities%rowtype;
  namespace text := split_part(p_provider_repo_id, '/', 1);
  slug text := split_part(p_provider_repo_id, '/', 2);
  linked_id uuid;
  current_count integer;
begin
  if not app.context_is_verified() or actor_profile is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;
  if p_provider_repo_id !~ '^[^/[:space:]]+/[^/[:space:]]+$'
    or p_source_revision !~ '^[a-f0-9]{40,64}$'
    or p_source_url !~ '^https://huggingface\.co/'
    or char_length(btrim(p_title)) not between 1 and 200
    or char_length(coalesce(p_summary, '')) > 2000
    or p_file_count not between 0 and 5000
    or p_total_size_bytes not between 0 and 21474836480
    or jsonb_typeof(p_source_metadata) <> 'object'
    or octet_length(p_source_metadata::text) > 32768 then
    raise exception 'linked_work_invalid' using errcode = '22023';
  end if;
  select * into identity from app.external_identities external_identity
  where external_identity.id = p_external_identity_id
    and external_identity.profile_id = actor_profile
    and external_identity.provider = 'huggingface'
    and external_identity.revoked_at is null;
  if identity.id is null then
    raise exception 'verified_identity_required' using errcode = '42501';
  end if;

  if p_owner_organization_id is null then
    if lower(identity.provider_username) <> lower(namespace) and not exists (
      select 1 from app.namespace_claims claim
      where claim.external_identity_id = identity.id
        and claim.profile_id = actor_profile
        and claim.namespace_kind = 'personal'
        and claim.status = 'verified'
        and lower(claim.provider_namespace) = lower(namespace)
    ) then
      raise exception 'linked_namespace_not_verified' using errcode = '42501';
    end if;
  else
    if not app.can_access_organization(p_owner_organization_id, true) or not exists (
      select 1 from app.namespace_claims claim
      where claim.external_identity_id = identity.id
        and claim.organization_id = p_owner_organization_id
        and claim.namespace_kind = 'organization'
        and claim.status = 'verified'
        and lower(claim.provider_namespace) = lower(namespace)
    ) then
      raise exception 'linked_organization_not_verified' using errcode = '42501';
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    coalesce(p_owner_organization_id::text, actor_profile::text) || ':linked-work', 0
  ));
  select count(*) into current_count from app.external_catalog_items item
  where item.status <> 'removed' and item.provider <> 'ollama' and (
    (p_owner_organization_id is null and item.owner_profile_id = actor_profile)
    or item.owner_organization_id = p_owner_organization_id
  );
  if current_count >= 100 and not exists (
    select 1 from app.external_catalog_items item
    where item.status <> 'removed'
      and item.provider = 'huggingface' and item.kind = p_kind
      and lower(item.provider_repo_id) = lower(p_provider_repo_id)
      and (
        (p_owner_organization_id is null and item.owner_profile_id = actor_profile)
        or item.owner_organization_id = p_owner_organization_id
      )
  ) then
    raise exception 'linked_work_limit_reached' using errcode = '23514';
  end if;

  select item.id into linked_id from app.external_catalog_items item
  where item.status <> 'removed'
    and item.provider = 'huggingface' and item.kind = p_kind
    and lower(item.provider_repo_id) = lower(p_provider_repo_id)
    and (
      (p_owner_organization_id is null and item.owner_profile_id = actor_profile)
      or item.owner_organization_id = p_owner_organization_id
    )
  for update;

  if linked_id is null then
    insert into app.external_catalog_items (
      owner_profile_id, owner_organization_id, external_identity_id, provider,
      kind, provider_repo_id, provider_namespace, provider_slug, source_url,
      source_revision, title, summary, license, file_count, total_size_bytes,
      provider_downloads, provider_likes, source_metadata, status, last_checked_at
    ) values (
      case when p_owner_organization_id is null then actor_profile end,
      p_owner_organization_id, identity.id, 'huggingface', p_kind,
      p_provider_repo_id, namespace, slug, p_source_url, p_source_revision,
      btrim(p_title), coalesce(p_summary, ''), nullif(btrim(coalesce(p_license, '')), ''),
      p_file_count, p_total_size_bytes,
      case when (p_source_metadata->>'provider_downloads') ~ '^[0-9]+$' then (p_source_metadata->>'provider_downloads')::bigint end,
      case when (p_source_metadata->>'provider_likes') ~ '^[0-9]+$' then (p_source_metadata->>'provider_likes')::bigint end,
      p_source_metadata, 'active', now()
    ) returning id into linked_id;
  else
    update app.external_catalog_items item set
      external_identity_id = identity.id,
      source_url = p_source_url,
      source_revision = p_source_revision,
      title = btrim(p_title),
      summary = coalesce(p_summary, ''),
      license = nullif(btrim(coalesce(p_license, '')), ''),
      file_count = p_file_count,
      total_size_bytes = p_total_size_bytes,
      provider_downloads = case when (p_source_metadata->>'provider_downloads') ~ '^[0-9]+$' then (p_source_metadata->>'provider_downloads')::bigint end,
      provider_likes = case when (p_source_metadata->>'provider_likes') ~ '^[0-9]+$' then (p_source_metadata->>'provider_likes')::bigint end,
      source_metadata = p_source_metadata,
      status = 'active',
      last_checked_at = now(),
      updated_at = now()
    where item.id = linked_id;
  end if;
  return linked_id;
end
$linked_work$;


create or replace function app.link_drive_catalog_item(p_kind public.repository_kind,p_url text,p_title text,p_license text,p_format text,p_rights jsonb)
returns uuid language plpgsql volatile security definer set search_path=app,pg_catalog
as $drive$
declare actor uuid:=app.current_profile_id(); linked_id uuid; source_key text; item_count integer;
begin
  if not app.context_is_verified() or actor is null then raise exception 'authentication_required' using errcode='42501'; end if;
  if p_kind not in ('model','dataset') or p_kind is null
    or p_url is null or p_url !~ '^https://drive\.google\.com/(file/d/[A-Za-z0-9_-]{10,200}/view|drive/folders/[A-Za-z0-9_-]{10,200})(\?resourcekey=[A-Za-z0-9_-]{1,200})?$'
    or p_title is null or char_length(btrim(p_title)) not between 2 and 200
    or p_license is null or char_length(btrim(p_license)) not between 1 and 120
    or p_format is null
    or (p_kind='model' and p_format not in ('gguf','mlx','safetensors','other'))
    or (p_kind='dataset' and p_format not in ('jsonl','parquet','csv','json','other'))
    or p_rights is null or jsonb_typeof(p_rights)<>'object' or octet_length(p_rights::text)>4096
    or coalesce(p_rights->>'confirmed','')<>'true' or coalesce(p_rights->>'download_confirmed','')<>'true'
    or coalesce(p_rights->>'basis','') not in ('original','permission','licensed-redistribution')
    or (p_rights->>'basis'<>'original' and (coalesce(p_rights->>'source_url','') !~ '^https://[^/@[:space:]]+([/:?][^[:space:]]*)?$' or char_length(p_rights->>'source_url')>2048))
  then raise exception 'invalid_drive_link' using errcode='22023'; end if;
  if not exists(select 1 from app.profiles where id=actor and is_public) then raise exception 'public_profile_required' using errcode='42501'; end if;
  source_key:=encode(public.digest(p_url,'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended(actor::text||':linked-work',0));
  select id into linked_id from app.external_catalog_items where owner_profile_id=actor and provider='google-drive'
    and kind=p_kind and provider_repo_id='drive/'||source_key and status<>'removed' for update;
  if linked_id is null then
    select count(*) into item_count from app.external_catalog_items where owner_profile_id=actor and provider<>'ollama' and status<>'removed';
    if item_count>=100 then raise exception 'linked_work_limit_reached' using errcode='23514'; end if;
    insert into app.external_catalog_items(owner_profile_id,provider,kind,provider_repo_id,provider_namespace,provider_slug,
      source_url,source_revision,title,summary,license,file_count,total_size_bytes,source_metadata)
    values(actor,'google-drive',p_kind,'drive/'||source_key,'drive',source_key,p_url,null,btrim(p_title),'',btrim(p_license),0,0,
      jsonb_build_object('format',p_format,'verification','member-declared','rights_declaration',p_rights,'declared_by',actor)) returning id into linked_id;
  else
    update app.external_catalog_items set title=btrim(p_title),license=btrim(p_license),status='active',
      source_metadata=jsonb_build_object('format',p_format,'verification','member-declared','rights_declaration',p_rights,'declared_by',actor),
      updated_at=now() where id=linked_id;
  end if;
  return linked_id;
end
$drive$;

commit;

begin;

-- Drive cards are member-declared external links, never imported or verified
-- repositories. Keep Hugging Face's verified-identity contract intact.
alter table app.external_catalog_items alter column external_identity_id drop not null;
alter table app.external_catalog_items alter column source_revision drop not null;
alter table app.external_catalog_items drop constraint if exists external_catalog_items_provider_check;
alter table app.external_catalog_items add constraint external_catalog_items_provider_check check (provider in ('huggingface','google-drive'));
alter table app.external_catalog_items drop constraint if exists external_catalog_items_source_url_check;
alter table app.external_catalog_items add constraint external_catalog_items_source_url_check check (
  (provider='huggingface' and source_url ~ '^https://huggingface\.co/') or
  (provider='google-drive' and source_url ~ '^https://drive\.google\.com/(file/d/[A-Za-z0-9_-]{10,200}/view|drive/folders/[A-Za-z0-9_-]{10,200})(\?resourcekey=[A-Za-z0-9_-]{1,200})?$')
);
alter table app.external_catalog_items drop constraint if exists external_catalog_items_source_revision_check;
alter table app.external_catalog_items add constraint external_catalog_items_source_revision_check check (
  (provider='huggingface' and external_identity_id is not null and source_revision is not null and source_revision ~ '^[a-f0-9]{40,64}$') or
  (provider='google-drive' and external_identity_id is null and source_revision is null and owner_profile_id is not null and kind in ('model','dataset') and provider_downloads is null and provider_likes is null)
);

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
    select count(*) into item_count from app.external_catalog_items where owner_profile_id=actor and status<>'removed';
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
revoke all on function app.link_drive_catalog_item(public.repository_kind,text,text,text,text,jsonb) from public,superii_web_backend,superii_payment_backend,superii_publishing_backend,superii_runtime_backend;
grant execute on function app.link_drive_catalog_item(public.repository_kind,text,text,text,text,jsonb) to superii_web_backend;
comment on table app.external_catalog_items is 'External work: verified Hugging Face namespace cards or explicitly member-declared Google Drive links. Neither grants Super ii publication approval.';
commit;

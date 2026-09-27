begin;

create table if not exists app.card_contact_vaults (
  profile_id uuid primary key references app.profiles(id) on delete cascade,
  ciphertext text not null,
  iv text not null,
  key_version text not null default 'v1',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint card_contact_vaults_ciphertext_check check (length(ciphertext) between 24 and 65536),
  constraint card_contact_vaults_iv_check check (iv ~ '^[A-Za-z0-9_-]{16}$')
);

create table if not exists app.cards (
  id uuid primary key default gen_random_uuid(),
  owner_profile_id uuid not null references app.profiles(id) on delete cascade,
  name text not null,
  preset text not null default 'custom',
  status text not null default 'draft',
  share_token_hash text not null unique,
  share_token_ciphertext text not null,
  share_token_iv text not null,
  config jsonb not null default '{}'::jsonb,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cards_name_check check (length(btrim(name)) between 1 and 80),
  constraint cards_preset_check check (preset in ('superii','business','personal','conference','investor','open_source','custom')),
  constraint cards_status_check check (status in ('draft','active','paused')),
  constraint cards_share_token_hash_check check (share_token_hash ~ '^[a-f0-9]{64}$'),
  constraint cards_share_token_ciphertext_check check (length(share_token_ciphertext) between 24 and 512),
  constraint cards_share_token_iv_check check (share_token_iv ~ '^[A-Za-z0-9_-]{16}$'),
  constraint cards_config_check check (jsonb_typeof(config) = 'object'),
  constraint cards_id_owner_unique unique (id, owner_profile_id)
);

create index if not exists cards_owner_updated_idx
  on app.cards(owner_profile_id, updated_at desc);

create table if not exists app.card_public_snapshots (
  card_id uuid primary key,
  owner_profile_id uuid not null references app.profiles(id) on delete cascade,
  snapshot jsonb not null,
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint card_public_snapshots_object_check check (jsonb_typeof(snapshot) = 'object'),
  constraint card_public_snapshots_revision_check check (revision > 0),
  constraint card_public_snapshots_owner_matches_card foreign key (card_id, owner_profile_id)
    references app.cards(id, owner_profile_id) on delete cascade
);

create index if not exists card_public_snapshots_owner_idx
  on app.card_public_snapshots(owner_profile_id, updated_at desc);

create table if not exists app.card_connections (
  id uuid primary key default gen_random_uuid(),
  owner_profile_id uuid not null references app.profiles(id) on delete cascade,
  card_id uuid not null,
  payload_ciphertext text not null,
  payload_iv text not null,
  context_ciphertext text,
  context_iv text,
  shared_card_id uuid references app.cards(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint card_connections_payload_check check (length(payload_ciphertext) between 24 and 16384),
  constraint card_connections_payload_iv_check check (payload_iv ~ '^[A-Za-z0-9_-]{16}$'),
  constraint card_connections_context_pair_check check (
    (context_ciphertext is null and context_iv is null)
    or (length(context_ciphertext) between 24 and 16384 and context_iv ~ '^[A-Za-z0-9_-]{16}$')
  ),
  constraint card_connections_owner_matches_card foreign key (card_id, owner_profile_id)
    references app.cards(id, owner_profile_id) on delete cascade
);

create index if not exists card_connections_owner_created_idx
  on app.card_connections(owner_profile_id, created_at desc);
create index if not exists card_connections_card_created_idx
  on app.card_connections(card_id, created_at desc);

alter table app.card_contact_vaults enable row level security;
alter table app.cards enable row level security;
alter table app.card_public_snapshots enable row level security;
alter table app.card_connections enable row level security;

-- Re-apply the global deny-first policy installer, then explicitly grant the
-- card tables to their owning web profile only. Public card reads never use
-- direct table access; they pass through resolve_public_card below.
call app_private.install_least_privilege_policies();

drop policy if exists card_contact_vaults_owner_all on app.card_contact_vaults;
create policy card_contact_vaults_owner_all on app.card_contact_vaults
  for all to superii_web_backend
  using (app.context_is_verified() and profile_id = app.current_profile_id())
  with check (app.context_is_verified() and profile_id = app.current_profile_id());

drop policy if exists cards_owner_all on app.cards;
create policy cards_owner_all on app.cards
  for all to superii_web_backend
  using (app.context_is_verified() and owner_profile_id = app.current_profile_id())
  with check (app.context_is_verified() and owner_profile_id = app.current_profile_id());

drop policy if exists card_public_snapshots_owner_all on app.card_public_snapshots;
create policy card_public_snapshots_owner_all on app.card_public_snapshots
  for all to superii_web_backend
  using (app.context_is_verified() and owner_profile_id = app.current_profile_id())
  with check (app.context_is_verified() and owner_profile_id = app.current_profile_id());

drop policy if exists card_connections_owner_all on app.card_connections;
create policy card_connections_owner_all on app.card_connections
  for all to superii_web_backend
  using (app.context_is_verified() and owner_profile_id = app.current_profile_id())
  with check (app.context_is_verified() and owner_profile_id = app.current_profile_id());

grant select, insert, update, delete on app.card_contact_vaults, app.cards,
  app.card_public_snapshots, app.card_connections to superii_web_backend;

create or replace function app.resolve_public_card(p_token_hash text)
returns table(card_id uuid, snapshot jsonb, revision integer, updated_at timestamptz)
language sql stable security definer
set search_path = app, pg_catalog
as $public_card$
  select published.card_id, published.snapshot, published.revision, published.updated_at
  from app.cards card
  join app.card_public_snapshots published on published.card_id = card.id
  where p_token_hash ~ '^[a-f0-9]{64}$'
    and card.share_token_hash = p_token_hash
    and card.status = 'active'
  limit 1
$public_card$;

create or replace function app.submit_card_connection(
  p_token_hash text,
  p_payload_ciphertext text,
  p_payload_iv text,
  p_context_ciphertext text default null,
  p_context_iv text default null
)
returns uuid
language plpgsql volatile security definer
set search_path = app, pg_catalog
as $connection$
declare
  target_card app.cards%rowtype;
  connection_id uuid;
begin
  if p_token_hash !~ '^[a-f0-9]{64}$'
    or length(p_payload_ciphertext) not between 24 and 16384
    or p_payload_iv !~ '^[A-Za-z0-9_-]{16}$'
    or ((p_context_ciphertext is null) <> (p_context_iv is null))
    or (p_context_ciphertext is not null and length(p_context_ciphertext) not between 24 and 16384)
    or (p_context_iv is not null and p_context_iv !~ '^[A-Za-z0-9_-]{16}$') then
    return null;
  end if;

  select card.* into target_card
  from app.cards card
  where card.share_token_hash = p_token_hash and card.status = 'active'
    and exists (
      select 1 from app.card_public_snapshots published
      where published.card_id = card.id
        and published.snapshot ->> 'allow_share_back' = 'true'
    )
  limit 1;
  if target_card.id is null then return null; end if;

  insert into app.card_connections (
    owner_profile_id, card_id, payload_ciphertext, payload_iv,
    context_ciphertext, context_iv
  ) values (
    target_card.owner_profile_id, target_card.id, p_payload_ciphertext,
    p_payload_iv, p_context_ciphertext, p_context_iv
  ) returning id into connection_id;
  return connection_id;
end
$connection$;

revoke all on function app.resolve_public_card(text) from public;
revoke all on function app.submit_card_connection(text,text,text,text,text) from public;
grant execute on function app.resolve_public_card(text),
  app.submit_card_connection(text,text,text,text,text) to superii_web_backend;

-- install_least_privilege_policies intentionally revokes all application
-- grants first. Restore the reviewed gateways from 0023 plus the later runtime
-- compatibility projection, then add only the two card gateways above.
do $restore_invoker_grants$
declare function_record record;
begin
  for function_record in
    select procedure.oid, pg_get_function_identity_arguments(procedure.oid) as arguments,
           procedure.proname
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'app' and procedure.prokind = 'f'
      and not procedure.prosecdef
  loop
    execute format(
      'grant execute on function app.%I(%s) to superii_web_backend, superii_payment_backend, superii_runtime_backend',
      function_record.proname, function_record.arguments
    );
  end loop;
end
$restore_invoker_grants$;

grant execute on function app.begin_request_context(
  text,text,text,text,text,uuid,uuid,uuid,uuid,boolean,bigint,uuid,text
) to superii_web_backend, superii_payment_backend, superii_publishing_backend;
grant execute on function app.context_is_verified(), app.current_context_service(),
  app.current_actor_kind(), app.current_clerk_user_id(), app.current_profile_id(),
  app.current_agent_identity_id(), app.current_social_agent_id(),
  app.context_is_admin()
  to superii_web_backend, superii_payment_backend, superii_publishing_backend;
grant execute on function app.can_access_organization(uuid,boolean),
  app.can_access_repository(uuid,boolean), app.tenant_can_read(text,jsonb),
  app.tenant_can_mutate(text,jsonb,text)
  to superii_web_backend, superii_payment_backend, superii_publishing_backend;
grant execute on function app.consume_scoped_access_token(text,text,uuid),
  app.consume_agent_access_token(text,text,uuid),
  app.consume_social_credential(text,text),
  app.consume_social_pairing_code(text,text,text,text[],timestamptz),
  app.submit_contact(text,text,text,text,text,text),
  app.consume_request_limit(text,text,integer,integer),
  app.record_highlight_event(uuid,text,text),
  app.record_robot_discovery(text,text,text),
  app.record_transparency_discovery(text,text,text)
  to superii_web_backend;
grant execute on function app.consume_commerce_delegation(text,text)
  to superii_payment_backend;
grant execute on function app.consume_request_limit(text,text,integer,integer)
  to superii_payment_backend, superii_publishing_backend;
grant execute on function app.finalize_proposal_leaderboard(date)
  to superii_web_backend;
grant select on app.agent_reputation to superii_web_backend;
grant select, insert, update, delete on app.repository_compatibility
  to superii_runtime_backend;

drop policy if exists publication_decisions_public_read on app.publication_decisions;
create policy publication_decisions_public_read on app.publication_decisions
  for select to superii_web_backend
  using (app.can_access_repository(repository_id, false));

revoke all on procedure app_private.install_least_privilege_policies()
  from public, superii_web_backend, superii_payment_backend,
       superii_publishing_backend, superii_runtime_backend;

comment on function app.resolve_public_card(text) is
  'Returns only the immutable public snapshot for an active unlisted card token';
comment on function app.submit_card_connection(text,text,text,text,text) is
  'Stores only size-bounded application-encrypted share-back data for an active card';

commit;

\set ON_ERROR_STOP on

-- The shell harness runs this file through four separate least-privilege
-- logins. Test-only keys never leave the ephemeral PostgreSQL container.
\if :{?CONTEXT_KEY}
\else
  \echo CONTEXT_KEY is required
  select 1/0;
\endif
\if :{?CONTEXT_SECRET}
\else
  \echo CONTEXT_SECRET is required
  select 1/0;
\endif

\if :IS_WEB
begin;
select app.begin_request_context(
  'web', :'CONTEXT_KEY', 'clerk', 'test_user_a', null,
  null, null, null, null, false,
  context.expires_at, context.nonce,
  encode(public.hmac(array_to_string(array[
    'superii-db-context-v1','web',:'CONTEXT_KEY','clerk','test_user_a','','','','','','0',
    context.expires_at::text,context.nonce::text
  ], E'\n'), :'CONTEXT_SECRET', 'sha256'), 'hex')
)
from (
  select extract(epoch from clock_timestamp() + interval '30 seconds')::bigint as expires_at,
         gen_random_uuid() as nonce
) context;
select app.ensure_profile('test_user_a','tenant-a','Tenant A',null) as profile_id \gset
commit;

begin;
select app.begin_request_context(
  'web', :'CONTEXT_KEY', 'clerk', 'test_user_a', null,
  :'profile_id'::uuid, null, null, null, false,
  context.expires_at, context.nonce,
  encode(public.hmac(array_to_string(array[
    'superii-db-context-v1','web',:'CONTEXT_KEY','clerk','test_user_a','',:'profile_id','','','','0',
    context.expires_at::text,context.nonce::text
  ], E'\n'), :'CONTEXT_SECRET', 'sha256'), 'hex')
)
from (
  select extract(epoch from clock_timestamp() + interval '30 seconds')::bigint as expires_at,
         gen_random_uuid() as nonce
) context;
do $public_surface$
begin
  if (select count(*) from app.fame_slots) <> 200 then
    raise exception 'public Hall of Fame inventory is incomplete';
  end if;
  perform count(*) from app.agent_reputation;
  perform app.finalize_proposal_leaderboard(
    (date_trunc('month', current_date) - interval '1 month')::date
  );
end
$public_surface$;
select * from app.create_repository_with_revision(
  :'profile_id'::uuid, null, 'model', 'private-model', 'Private model',
  'Tenant A private model', 'mit', null, null, null, '',
  '{"rights":"original"}'::jsonb
) \gset repository_
update app.repositories set visibility='private'
where id=:'repository_repository_id'::uuid;
commit;

begin;
select app.begin_request_context(
  'web', :'CONTEXT_KEY', 'clerk', 'test_user_b', null,
  null, null, null, null, false,
  context.expires_at, context.nonce,
  encode(public.hmac(array_to_string(array[
    'superii-db-context-v1','web',:'CONTEXT_KEY','clerk','test_user_b','','','','','','0',
    context.expires_at::text,context.nonce::text
  ], E'\n'), :'CONTEXT_SECRET', 'sha256'), 'hex')
)
from (
  select extract(epoch from clock_timestamp() + interval '30 seconds')::bigint as expires_at,
         gen_random_uuid() as nonce
) context;
select app.ensure_profile('test_user_b','tenant-b','Tenant B',null) as profile_id \gset
commit;

begin;
select app.begin_request_context(
  'web', :'CONTEXT_KEY', 'clerk', 'test_user_b', null,
  :'profile_id'::uuid, null, null, null, false,
  context.expires_at, context.nonce,
  encode(public.hmac(array_to_string(array[
    'superii-db-context-v1','web',:'CONTEXT_KEY','clerk','test_user_b','',:'profile_id','','','','0',
    context.expires_at::text,context.nonce::text
  ], E'\n'), :'CONTEXT_SECRET', 'sha256'), 'hex')
)
from (
  select extract(epoch from clock_timestamp() + interval '30 seconds')::bigint as expires_at,
         gen_random_uuid() as nonce
) context;
do $cross_tenant$
begin
  if exists(select 1 from app.repositories where slug='private-model') then
    raise exception 'cross-tenant private repository read succeeded';
  end if;
end
$cross_tenant$;
commit;

\elif :IS_PAYMENT
begin;
select app.begin_request_context(
  'payment', :'CONTEXT_KEY', 'payment-webhook', null, null,
  null, null, null, null, false,
  context.expires_at, context.nonce,
  encode(public.hmac(array_to_string(array[
    'superii-db-context-v1','payment',:'CONTEXT_KEY','payment-webhook','','','','','','','0',
    context.expires_at::text,context.nonce::text
  ], E'\n'), :'CONTEXT_SECRET', 'sha256'), 'hex')
)
from (
  select extract(epoch from clock_timestamp() + interval '30 seconds')::bigint as expires_at,
         gen_random_uuid() as nonce
) context;
select count(*) >= 0 as payment_context_ok from app.payment_orders;
select app.consume_request_limit(repeat('a',64),'test.payment',5,60);
do $payment_boundary$
begin
  if has_table_privilege(current_user,'app.agent_access_tokens','SELECT') then
    raise exception 'payment login can read agent access tokens';
  end if;
end
$payment_boundary$;
commit;

\elif :IS_PUBLISHING
begin;
select app.begin_request_context(
  'publishing', :'CONTEXT_KEY', 'publishing-oidc', null, null,
  null, null, null, null, false,
  context.expires_at, context.nonce,
  encode(public.hmac(array_to_string(array[
    'superii-db-context-v1','publishing',:'CONTEXT_KEY','publishing-oidc','','','','','','','0',
    context.expires_at::text,context.nonce::text
  ], E'\n'), :'CONTEXT_SECRET', 'sha256'), 'hex')
)
from (
  select extract(epoch from clock_timestamp() + interval '30 seconds')::bigint as expires_at,
         gen_random_uuid() as nonce
) context;
select app.consume_request_limit(repeat('b',64),'test.publishing',5,60);
do $publishing_boundary$
begin
  if not has_table_privilege(current_user,'app.trusted_publishers','SELECT')
    or has_table_privilege(current_user,'app.payment_orders','SELECT') then
    raise exception 'publishing login privilege boundary is incorrect';
  end if;
end
$publishing_boundary$;
commit;

\elif :IS_RUNTIME
do $runtime_boundary$
begin
  if not has_table_privilege(current_user,'app.repository_files','SELECT,INSERT,UPDATE,DELETE')
    or has_table_privilege(current_user,'app.payment_orders','SELECT')
    or has_schema_privilege(current_user,'app_private','USAGE') then
    raise exception 'runtime login privilege boundary is incorrect';
  end if;
end
$runtime_boundary$;

\else
  \echo one runtime-role test selector must be enabled
  select 1/0;
\endif

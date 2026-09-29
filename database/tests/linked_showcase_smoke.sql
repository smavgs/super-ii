\set ON_ERROR_STOP on

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

begin;

select app.begin_request_context(
  'web', :'CONTEXT_KEY', 'clerk', 'linked_showcase_test_user', null,
  null, null, null, null, false,
  context.expires_at, context.nonce,
  encode(public.hmac(array_to_string(array[
    'superii-db-context-v1','web',:'CONTEXT_KEY','clerk','linked_showcase_test_user','','','','','','0',
    context.expires_at::text,context.nonce::text
  ], E'\n'), :'CONTEXT_SECRET', 'sha256'), 'hex')
)
from (
  select extract(epoch from clock_timestamp() + interval '30 seconds')::bigint as expires_at,
         gen_random_uuid() as nonce
) context;

select app.ensure_profile(
  'linked_showcase_test_user', 'linked-showcase', 'Linked Showcase', null
) as profile_id \gset

update app.profiles
set is_public = true, profile_kind = 'studio'
where id = :'profile_id'::uuid;

insert into app.external_identities (
  profile_id, provider, provider_subject, provider_username, display_name,
  scopes, organizations, metadata
) values (
  :'profile_id'::uuid, 'huggingface', 'linked-showcase-subject',
  'linked-showcase', 'Linked Showcase', array['openid'], '[]'::jsonb,
  '{"test":true}'::jsonb
) returning id as identity_id \gset

select app.link_external_catalog_item(
  :'identity_id'::uuid, null, 'model'::public.repository_kind,
  'linked-showcase/tiny-model', repeat('a', 40),
  'https://huggingface.co/linked-showcase/tiny-model',
  'Tiny linked model', 'Provider-hosted metadata only.', 'mit', 2, 2048,
  '{"provider_downloads":"17","provider_likes":"3","task":"text-generation"}'::jsonb
) as linked_id \gset

select set_config('linked_showcase.profile_id', :'profile_id', true);
select set_config('linked_showcase.linked_id', :'linked_id', true);
select set_config('linked_showcase.identity_id', :'identity_id', true);

do $linked_work$
declare rejected boolean := false;
begin
  if not exists (
    select 1 from app.external_catalog_items
    where id = current_setting('linked_showcase.linked_id', true)::uuid
  ) then
    raise exception 'linked work row was not visible to its owner';
  end if;
  begin
    perform app.link_external_catalog_item(
      current_setting('linked_showcase.identity_id', true)::uuid, null,
      'model'::public.repository_kind, 'unverified/tiny-model', repeat('b', 40),
      'https://huggingface.co/unverified/tiny-model', 'Unverified model', '', null,
      1, 1024, '{}'::jsonb
    );
  exception when insufficient_privilege then rejected := true;
  end;
  if not rejected then raise exception 'unverified provider namespace was accepted'; end if;
end
$linked_work$;

select * from app.create_showcase_media(
  null, null,
  'showcase/profile/' || :'profile_id' || '/10000000-0000-4000-8000-000000000001.jpg',
  repeat('1', 64), 2048, 1280, 800, 'One', '', 'First work image', null
) \gset media_one_
select * from app.create_showcase_media(
  null, null,
  'showcase/profile/' || :'profile_id' || '/10000000-0000-4000-8000-000000000002.jpg',
  repeat('2', 64), 2048, 1280, 800, 'Two', '', 'Second work image', 'https://example.test/two'
) \gset media_two_
select * from app.create_showcase_media(
  null, null,
  'showcase/profile/' || :'profile_id' || '/10000000-0000-4000-8000-000000000003.jpg',
  repeat('3', 64), 2048, 1280, 800, 'Three', '', 'Third work image', null
) \gset media_three_

select set_config('linked_showcase.media_one_id', :'media_one_media_id', true);
select set_config('linked_showcase.media_two_id', :'media_two_media_id', true);
select set_config('linked_showcase.media_three_id', :'media_three_media_id', true);

do $showcase_limit$
declare rejected boolean := false;
begin
  begin
    perform * from app.create_showcase_media(
      null, null,
      'showcase/profile/' || current_setting('linked_showcase.profile_id', true) || '/10000000-0000-4000-8000-000000000004.jpg',
      repeat('4', 64), 2048, 1280, 800, 'Four', '', 'Fourth work image', null
    );
  exception when check_violation then rejected := true;
  end;
  if not rejected then raise exception 'fourth profile showcase image was accepted'; end if;
end
$showcase_limit$;

do $showcase_checks$
declare resolved record;
begin
  if not app.update_showcase_media(
    current_setting('linked_showcase.media_one_id')::uuid,
    'One updated', 'Caption', 'Updated first image',
    'https://example.test/one', 2::smallint
  ) then raise exception 'showcase reorder returned false'; end if;
  if (select position from app.showcase_media where id = current_setting('linked_showcase.media_one_id')::uuid) <> 2
    or (select position from app.showcase_media where id = current_setting('linked_showcase.media_two_id')::uuid) <> 1 then
    raise exception 'showcase positions were not swapped safely';
  end if;
  select * into resolved from app.resolve_public_showcase_media(current_setting('linked_showcase.media_one_id')::uuid);
  if resolved.object_key is null then raise exception 'public showcase resolver returned no object'; end if;
end
$showcase_checks$;

select * from app.create_robot_with_version(
  :'profile_id'::uuid, null, 'showcase-rover', 'Showcase Rover',
  'A public Robot used by the linked showcase smoke test.', 'New builders', 'public',
  '{"goal":"learn"}'::jsonb, '{"catalog_revision":"linked-showcase-test","robot_check":[]}'::jsonb,
  'linked-test', 'First public version', null
) \gset robot_

select set_config('linked_showcase.robot_id', :'robot_robot_id', true);

do $robot_showcase$
begin
  if not app.update_robot_showcase(
    current_setting('linked_showcase.robot_id')::uuid,
    'prototype', array['navigation','vision'],
    'Python control service with a public source tree.',
    '[{"kind":"source","label":"Source","url":"https://example.test/source"},
      {"kind":"docs","label":"Build notes","url":"https://example.test/docs"}]'::jsonb
  ) then raise exception 'Robot showcase update returned false'; end if;
  if (select project_stage from app.robots where id = current_setting('linked_showcase.robot_id')::uuid) <> 'prototype'
    or (select count(*) from app.robot_links where robot_id = current_setting('linked_showcase.robot_id')::uuid) <> 2 then
    raise exception 'Robot showcase metadata was not persisted';
  end if;
end
$robot_showcase$;

select * from app.create_showcase_media(
  null, :'robot_robot_id'::uuid,
  'showcase/profile/' || :'profile_id' || '/20000000-0000-4000-8000-000000000001.jpg',
  repeat('5', 64), 2048, 1280, 800, 'Robot view', '', 'Public Robot prototype', null
) \gset robot_media_

do $cleanup_contract$
begin
  if not app.unlink_external_catalog_item(current_setting('linked_showcase.linked_id')::uuid) then
    raise exception 'linked work unlink returned false';
  end if;
  if (select status from app.external_catalog_items where id = current_setting('linked_showcase.linked_id')::uuid) <> 'removed' then
    raise exception 'linked work was not soft removed';
  end if;
  if app.delete_showcase_media(current_setting('linked_showcase.media_three_id')::uuid) is null then
    raise exception 'showcase delete did not return its R2 key';
  end if;
end
$cleanup_contract$;

rollback;

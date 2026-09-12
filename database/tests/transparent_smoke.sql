\set ON_ERROR_STOP on
begin;

insert into app.profiles (id, clerk_user_id, handle, display_name)
values ('10000000-0000-4000-8000-000000000020', 'transparent-user', 'transparent-user', 'Transparent User');

insert into app.external_identities (
  id, profile_id, provider, provider_subject, provider_username, scopes
) values (
  '20000000-0000-4000-8000-000000000020',
  '10000000-0000-4000-8000-000000000020',
  'huggingface', 'transparent-subject', 'transparent-user', array['openid','profile']
);

insert into app.transparency_reports (
  id, report_key, provider, repository_kind, repository_id, repository_owner,
  source_revision, requested_revision, criteria_version, snapshot, snapshot_sha256, checked_at
) values (
  '30000000-0000-4000-8000-000000000020', repeat('a',64), 'huggingface', 'model',
  'transparent-user/model-one', 'transparent-user', repeat('1',40), 'main', 'hf-public-v1.0',
  jsonb_build_object('report_key',repeat('a',64),'provider','huggingface','criteria_version','hf-public-v1.0','repository',jsonb_build_object('resolved_revision',repeat('1',40)),'evidence',jsonb_build_array()),
  repeat('b',64), now() - interval '1 minute'
);

insert into app.transparency_report_watches (report_id, profile_id, last_seen_revision)
values ('30000000-0000-4000-8000-000000000020','10000000-0000-4000-8000-000000000020',repeat('1',40));

insert into app.transparency_reports (
  id, report_key, provider, repository_kind, repository_id, repository_owner,
  source_revision, requested_revision, criteria_version, snapshot, snapshot_sha256, checked_at
) values (
  '40000000-0000-4000-8000-000000000020', repeat('c',64), 'huggingface', 'model',
  'transparent-user/model-one', 'transparent-user', repeat('2',40), 'main', 'hf-public-v1.0',
  jsonb_build_object('report_key',repeat('c',64),'provider','huggingface','criteria_version','hf-public-v1.0','repository',jsonb_build_object('resolved_revision',repeat('2',40)),'evidence',jsonb_build_array()),
  repeat('d',64), now()
);

select app.advance_transparency_watches('40000000-0000-4000-8000-000000000020');
select app.record_transparency_discovery('mcp','check','transparent-user/model-one');

insert into app.transparency_repository_claims (
  provider, repository_kind, repository_id, repository_owner, profile_id, external_identity_id, verification_method
) values (
  'huggingface','model','transparent-user/model-one','transparent-user',
  '10000000-0000-4000-8000-000000000020','20000000-0000-4000-8000-000000000020','huggingface-oauth-owner-match'
);

do $$ begin
  if not exists (
    select 1 from app.transparency_report_watches
    where report_id = '30000000-0000-4000-8000-000000000020'
      and latest_report_id = '40000000-0000-4000-8000-000000000020'
  ) then raise exception 'transparency watch did not advance'; end if;
  if not exists (
    select 1 from app.notifications where profile_id = '10000000-0000-4000-8000-000000000020'
      and event_type = 'transparency.new_revision'
  ) then raise exception 'transparency watch notification missing'; end if;
  if (select events from app.transparency_discovery_daily where channel='mcp' and action='check' and resource_key='transparent-user/model-one') <> 1
  then raise exception 'transparency discovery aggregate mismatch'; end if;
end $$;

do $$ begin
  begin
    update app.transparency_reports set requested_revision = 'changed' where id = '30000000-0000-4000-8000-000000000020';
    raise exception 'immutable transparency report unexpectedly changed';
  exception when object_not_in_prerequisite_state then null;
  end;
end $$;

rollback;

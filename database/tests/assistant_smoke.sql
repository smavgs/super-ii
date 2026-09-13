\set ON_ERROR_STOP on
begin;

insert into app.profiles (id, clerk_user_id, handle, display_name)
values
  ('10000000-0000-4000-8000-000000000020', 'assistant-owner-user', 'assistant-owner', 'Assistant Owner'),
  ('20000000-0000-4000-8000-000000000020', 'assistant-other-user', 'assistant-other', 'Assistant Other');

select * from app.persist_assistant_exchange(
  '10000000-0000-4000-8000-000000000020', null,
  'Help me understand Super ii continuity.',
  'Your paid chat can be saved with user-controlled memory.',
  'openrouter', 'openrouter/free', '/pricing', 1048576
) \gset first_

select * from app.persist_assistant_exchange(
  '10000000-0000-4000-8000-000000000020', :'first_thread_id',
  'Can I archive this conversation?',
  'Yes. You can archive, restore, search, or permanently delete it.',
  'openrouter', 'openrouter/free', '/pricing', 1048576
) \gset second_

select app.set_assistant_thread_state(
  '10000000-0000-4000-8000-000000000020', :'first_thread_id', 'archived', 'Launch research'
);
select app.set_assistant_memory_enabled('10000000-0000-4000-8000-000000000020', true);
select app.add_assistant_memory(
  '10000000-0000-4000-8000-000000000020',
  'Preferred workflow', 'Use bounded, evidence-first continuity.', :'first_thread_id', 1048576
) as memory_id \gset
select app.update_assistant_memory(
  '10000000-0000-4000-8000-000000000020', :'memory_id',
  'Preferred workflow', 'Use bounded, evidence-first continuity with explicit deletion.', 1048576
);

select set_config('test.assistant_thread_id', :'first_thread_id', true);
select set_config('test.assistant_memory_id', :'memory_id', true);

do $$
declare
  owner_id constant uuid := '10000000-0000-4000-8000-000000000020';
  other_id constant uuid := '20000000-0000-4000-8000-000000000020';
  v_thread_id uuid := current_setting('test.assistant_thread_id')::uuid;
  v_memory_id uuid := current_setting('test.assistant_memory_id')::uuid;
begin
  if (select count(*) from app.assistant_messages where assistant_messages.thread_id = v_thread_id) <> 4 then
    raise exception 'assistant exchange did not persist exactly two bounded message pairs';
  end if;
  if not exists (
    select 1 from app.assistant_threads
    where id = v_thread_id and profile_id = owner_id and status = 'archived' and project_label = 'Launch research'
  ) then
    raise exception 'assistant archive or project state was not preserved';
  end if;
  if not exists (
    select 1 from app.assistant_memory_preferences
    where profile_id = owner_id and memory_enabled
  ) or not exists (
    select 1 from app.assistant_memory_items
    where id = v_memory_id and profile_id = owner_id and content like '%explicit deletion%'
  ) then
    raise exception 'assistant memory preference or editable item was not preserved';
  end if;
  if not exists (
    select 1 from app.assistant_messages
    where assistant_messages.thread_id = v_thread_id
      and search_document @@ websearch_to_tsquery('simple', 'continuity')
  ) then
    raise exception 'assistant full-text history search is not queryable';
  end if;
  if app.assistant_storage_used_bytes(owner_id) <= 0
    or app.profile_hosted_storage_used_bytes(owner_id) < app.assistant_storage_used_bytes(owner_id) then
    raise exception 'assistant storage accounting is incomplete';
  end if;

  begin
    perform * from app.persist_assistant_exchange(
      owner_id, v_thread_id, 'This must fail.', 'This must not be stored.',
      'openrouter', 'openrouter/free', '/', 1
    );
    raise exception 'assistant storage ceiling unexpectedly allowed an over-limit write';
  exception when raise_exception then
    if sqlerrm <> 'assistant_storage_limit_reached' then raise; end if;
  end;

  begin
    perform * from app.persist_assistant_exchange(
      other_id, v_thread_id, 'Cross-owner write.', 'This must not be stored.',
      'openrouter', 'openrouter/free', '/', 1048576
    );
    raise exception 'cross-owner assistant write unexpectedly succeeded';
  exception when no_data_found then null;
  end;

  begin
    update app.assistant_messages set content = 'mutated' where assistant_messages.thread_id = v_thread_id;
    raise exception 'immutable assistant message unexpectedly changed';
  exception when object_not_in_prerequisite_state then null;
  end;

  begin
    delete from app.assistant_usage_ledger where profile_id = owner_id;
    raise exception 'immutable assistant usage event unexpectedly deleted';
  exception when object_not_in_prerequisite_state then null;
  end;
end
$$;

select app.delete_assistant_thread(
  '10000000-0000-4000-8000-000000000020', :'first_thread_id'
);
select app.delete_assistant_memory(
  '10000000-0000-4000-8000-000000000020', :'memory_id'
);

do $$
begin
  if exists (
    select 1 from app.assistant_threads
    where id = current_setting('test.assistant_thread_id')::uuid
  ) or exists (
    select 1 from app.assistant_memory_items
    where id = current_setting('test.assistant_memory_id')::uuid
  ) then
    raise exception 'assistant hard-delete controls left owned content behind';
  end if;
end
$$;

delete from app.profiles
where id = '10000000-0000-4000-8000-000000000020';

do $$
begin
  if exists (
    select 1 from app.assistant_threads
    where profile_id = '10000000-0000-4000-8000-000000000020'
  ) or exists (
    select 1 from app.assistant_memory_preferences
    where profile_id = '10000000-0000-4000-8000-000000000020'
  ) or exists (
    select 1 from app.assistant_memory_items
    where profile_id = '10000000-0000-4000-8000-000000000020'
  ) then
    raise exception 'profile deletion left assistant content behind';
  end if;
  if not exists (
    select 1 from app.assistant_usage_ledger
    where profile_id = '10000000-0000-4000-8000-000000000020'
  ) then
    raise exception 'profile deletion unexpectedly erased the content-free usage ledger';
  end if;
end
$$;

rollback;

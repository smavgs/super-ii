begin;

create table if not exists app.request_limits (
  network_hash text not null check (network_hash ~ '^[a-f0-9]{64}$'),
  action text not null check (char_length(action) between 1 and 80),
  window_started_at timestamptz not null default now(),
  request_count integer not null default 1 check (request_count > 0),
  updated_at timestamptz not null default now(),
  primary key (network_hash, action)
);

create or replace function app.ensure_profile(
  p_clerk_user_id text,
  p_requested_handle text,
  p_display_name text,
  p_avatar_url text
)
returns uuid
language plpgsql
security invoker
set search_path = app, pg_catalog, public
as $$
declare
  existing_id uuid;
  base_handle text;
  candidate_handle text;
begin
  if nullif(btrim(p_clerk_user_id), '') is null then
    raise exception 'clerk_user_id_required' using errcode = '22023';
  end if;

  select id into existing_id from app.profiles where clerk_user_id = p_clerk_user_id;
  if existing_id is not null then
    update app.profiles
    set display_name = left(coalesce(nullif(btrim(p_display_name), ''), display_name), 100),
        avatar_url = nullif(p_avatar_url, ''),
        updated_at = now()
    where id = existing_id;
    return existing_id;
  end if;

  base_handle := lower(regexp_replace(coalesce(p_requested_handle, ''), '[^a-zA-Z0-9-]+', '-', 'g'));
  base_handle := regexp_replace(base_handle, '(^-+|-+$)', '', 'g');
  base_handle := left(base_handle, 30);
  base_handle := regexp_replace(base_handle, '-+$', '');
  if base_handle = '' then
    base_handle := 'user';
  end if;
  candidate_handle := base_handle;
  if exists (select 1 from app.profiles where lower(handle) = candidate_handle) then
    candidate_handle := left(base_handle, 29) || '-' || substr(encode(digest(p_clerk_user_id, 'sha256'), 'hex'), 1, 8);
  end if;

  insert into app.profiles (clerk_user_id, handle, display_name, avatar_url)
  values (
    p_clerk_user_id,
    candidate_handle,
    left(coalesce(nullif(btrim(p_display_name), ''), candidate_handle), 100),
    nullif(p_avatar_url, '')
  )
  returning id into existing_id;
  return existing_id;
end;
$$;

create or replace function app.create_discussion(
  p_repository_id uuid,
  p_author_profile_id uuid,
  p_title text,
  p_body text
)
returns uuid
language plpgsql
security invoker
set search_path = app, pg_catalog
as $$
declare
  discussion_id uuid;
begin
  if not exists (
    select 1 from app.repositories
    where id = p_repository_id and visibility = 'public' and status = 'published'
  ) then
    raise exception 'repository_not_found' using errcode = 'P0002';
  end if;
  insert into app.discussions (repository_id, author_profile_id, title, body)
  values (p_repository_id, p_author_profile_id, btrim(p_title), btrim(p_body))
  returning id into discussion_id;
  insert into app.discussion_events (discussion_id, actor_profile_id, event_type)
  values (discussion_id, p_author_profile_id, 'created');
  insert into app.activity_events (actor_profile_id, repository_id, event_type, metadata)
  values (
    p_author_profile_id,
    p_repository_id,
    'discussion.created',
    jsonb_build_object('discussion_id', discussion_id)
  );
  return discussion_id;
end;
$$;

create or replace function app.add_discussion_comment(
  p_discussion_id uuid,
  p_author_profile_id uuid,
  p_parent_comment_id uuid,
  p_body text
)
returns uuid
language plpgsql
security invoker
set search_path = app, pg_catalog
as $$
declare
  comment_id uuid;
  target_repository_id uuid;
begin
  select repository_id into target_repository_id
  from app.discussions
  where id = p_discussion_id and status = 'open';
  if target_repository_id is null then
    raise exception 'discussion_not_open' using errcode = 'P0001';
  end if;
  if p_parent_comment_id is not null and not exists (
    select 1 from app.discussion_comments
    where id = p_parent_comment_id and discussion_id = p_discussion_id
  ) then
    raise exception 'parent_comment_not_found' using errcode = 'P0002';
  end if;
  insert into app.discussion_comments (
    discussion_id, author_profile_id, parent_comment_id, body
  ) values (
    p_discussion_id, p_author_profile_id, p_parent_comment_id, btrim(p_body)
  ) returning id into comment_id;
  update app.discussions set updated_at = now() where id = p_discussion_id;
  insert into app.discussion_events (discussion_id, actor_profile_id, event_type, metadata)
  values (
    p_discussion_id,
    p_author_profile_id,
    'commented',
    jsonb_build_object('comment_id', comment_id)
  );
  insert into app.activity_events (actor_profile_id, repository_id, event_type, metadata)
  values (
    p_author_profile_id,
    target_repository_id,
    'discussion.commented',
    jsonb_build_object('discussion_id', p_discussion_id, 'comment_id', comment_id)
  );
  return comment_id;
end;
$$;

create or replace function app.set_repository_like(
  p_repository_id uuid,
  p_profile_id uuid,
  p_active boolean
)
returns boolean
language plpgsql
security invoker
set search_path = app, pg_catalog
as $$
declare
  changed_count integer;
begin
  if not exists (
    select 1 from app.repositories
    where id = p_repository_id and visibility = 'public' and status = 'published'
  ) then
    raise exception 'repository_not_found' using errcode = 'P0002';
  end if;
  if p_active then
    insert into app.likes (profile_id, repository_id)
    values (p_profile_id, p_repository_id)
    on conflict do nothing;
  else
    delete from app.likes
    where profile_id = p_profile_id and repository_id = p_repository_id;
  end if;
  get diagnostics changed_count = row_count;
  if changed_count > 0 then
    insert into app.activity_events (actor_profile_id, repository_id, event_type)
    values (
      p_profile_id,
      p_repository_id,
      case when p_active then 'repository.liked' else 'repository.unliked' end
    );
  end if;
  return p_active;
end;
$$;

create or replace function app.set_repository_watch(
  p_repository_id uuid,
  p_profile_id uuid,
  p_level text
)
returns text
language plpgsql
security invoker
set search_path = app, pg_catalog
as $$
declare
  previous_level text;
begin
  if not exists (
    select 1 from app.repositories
    where id = p_repository_id and visibility = 'public' and status = 'published'
  ) then
    raise exception 'repository_not_found' using errcode = 'P0002';
  end if;
  select level into previous_level
  from app.repository_watchers
  where profile_id = p_profile_id and repository_id = p_repository_id;
  if p_level is null or p_level = 'off' then
    delete from app.repository_watchers
    where profile_id = p_profile_id and repository_id = p_repository_id;
    if previous_level is not null then
      insert into app.activity_events (actor_profile_id, repository_id, event_type)
      values (p_profile_id, p_repository_id, 'repository.unwatched');
    end if;
    return 'off';
  end if;
  if p_level not in ('all', 'releases', 'discussions') then
    raise exception 'invalid_watch_level' using errcode = '22023';
  end if;
  insert into app.repository_watchers (profile_id, repository_id, level)
  values (p_profile_id, p_repository_id, p_level)
  on conflict (profile_id, repository_id) do update
  set level = excluded.level, updated_at = now();
  if previous_level is distinct from p_level then
    insert into app.activity_events (actor_profile_id, repository_id, event_type, metadata)
    values (p_profile_id, p_repository_id, 'repository.watched', jsonb_build_object('level', p_level));
  end if;
  return p_level;
end;
$$;

create or replace function app.set_profile_follow(
  p_follower_profile_id uuid,
  p_followed_profile_id uuid,
  p_active boolean
)
returns boolean
language plpgsql
security invoker
set search_path = app, pg_catalog
as $$
declare
  changed_count integer;
begin
  if p_follower_profile_id = p_followed_profile_id then
    raise exception 'cannot_follow_self' using errcode = '22023';
  end if;
  if not exists (
    select 1 from app.profiles
    where id = p_followed_profile_id and is_public = true
  ) then
    raise exception 'profile_not_found' using errcode = 'P0002';
  end if;
  if p_active then
    insert into app.follows (follower_profile_id, followed_profile_id)
    values (p_follower_profile_id, p_followed_profile_id)
    on conflict do nothing;
  else
    delete from app.follows
    where follower_profile_id = p_follower_profile_id
      and followed_profile_id = p_followed_profile_id;
  end if;
  get diagnostics changed_count = row_count;
  if changed_count > 0 then
    insert into app.activity_events (actor_profile_id, event_type, metadata)
    values (
      p_follower_profile_id,
      case when p_active then 'profile.followed' else 'profile.unfollowed' end,
      jsonb_build_object('profile_id', p_followed_profile_id)
    );
  end if;
  return p_active;
end;
$$;

create or replace function app.set_reaction(
  p_profile_id uuid,
  p_target_type text,
  p_target_id uuid,
  p_reaction text,
  p_active boolean
)
returns boolean
language plpgsql
security invoker
set search_path = app, pg_catalog
as $$
declare
  target_repository_id uuid;
  changed_count integer;
begin
  if p_target_type = 'discussion' then
    select d.repository_id into target_repository_id
    from app.discussions d
    join app.repositories r on r.id = d.repository_id
    where d.id = p_target_id and r.visibility = 'public' and r.status = 'published';
  elsif p_target_type = 'comment' then
    select d.repository_id into target_repository_id
    from app.discussion_comments c
    join app.discussions d on d.id = c.discussion_id
    join app.repositories r on r.id = d.repository_id
    where c.id = p_target_id and r.visibility = 'public' and r.status = 'published';
  else
    raise exception 'invalid_reaction_target' using errcode = '22023';
  end if;
  if target_repository_id is null then
    raise exception 'reaction_target_not_found' using errcode = 'P0002';
  end if;
  if p_reaction not in ('like', 'helpful', 'celebrate', 'heart', 'eyes') then
    raise exception 'invalid_reaction' using errcode = '22023';
  end if;

  if p_active then
    insert into app.reactions (profile_id, target_type, target_id, reaction)
    values (p_profile_id, p_target_type, p_target_id, p_reaction)
    on conflict do nothing;
  else
    delete from app.reactions
    where profile_id = p_profile_id
      and target_type = p_target_type
      and target_id = p_target_id
      and reaction = p_reaction;
  end if;
  get diagnostics changed_count = row_count;
  if changed_count > 0 then
    insert into app.activity_events (actor_profile_id, repository_id, event_type, metadata)
    values (
      p_profile_id,
      target_repository_id,
      case when p_active then 'reaction.added' else 'reaction.removed' end,
      jsonb_build_object('target_type', p_target_type, 'target_id', p_target_id, 'reaction', p_reaction)
    );
  end if;
  return p_active;
end;
$$;

create or replace function app.consume_request_limit(
  p_network_hash text,
  p_action text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security invoker
set search_path = app, pg_catalog
as $$
declare
  resulting_count integer;
begin
  if p_network_hash !~ '^[a-f0-9]{64}$'
    or p_limit < 1
    or p_window_seconds < 1
    or nullif(btrim(p_action), '') is null then
    raise exception 'invalid_rate_limit_input' using errcode = '22023';
  end if;
  insert into app.request_limits (network_hash, action, window_started_at, request_count)
  values (p_network_hash, left(p_action, 80), now(), 1)
  on conflict (network_hash, action) do update set
    window_started_at = case
      when app.request_limits.window_started_at <= now() - make_interval(secs => p_window_seconds)
        then now()
      else app.request_limits.window_started_at
    end,
    request_count = case
      when app.request_limits.window_started_at <= now() - make_interval(secs => p_window_seconds)
        then 1
      else app.request_limits.request_count + 1
    end,
    updated_at = now()
  returning request_count into resulting_count;
  return resulting_count <= p_limit;
end;
$$;

alter table app.request_limits enable row level security;

commit;

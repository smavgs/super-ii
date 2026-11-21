begin;

-- A boolean lookup covers private profiles too, without exposing profile data.
create or replace function app.profile_handle_available(p_handle text)
returns boolean language sql stable security definer
set search_path = app, pg_catalog as $$
  select app.context_is_verified()
    and p_handle ~ '^[a-z0-9]([a-z0-9-]{0,28}[a-z0-9])?$'
    and p_handle <> all(array['admin','administrator','support','superii','super-ii','moderator','security','system'])
    and not exists (select 1 from app.profiles where lower(handle) = p_handle)
$$;
revoke all on function app.profile_handle_available(text) from public;
grant execute on function app.profile_handle_available(text) to superii_web_backend;

-- Preserve existing handles. The unique indexes arbitrate simultaneous signups,
-- including a collision with a private profile invisible to the caller's RLS.
create or replace function app.ensure_profile(p_clerk_user_id text, p_requested_handle text, p_display_name text, p_avatar_url text)
returns uuid language plpgsql security invoker set search_path = app, pg_catalog, public as $$
declare existing_id uuid; base_handle text; candidate_handle text; attempt integer;
begin
  if nullif(btrim(p_clerk_user_id), '') is null then
    raise exception 'clerk_user_id_required' using errcode = '22023';
  end if;
  select id into existing_id from app.profiles where clerk_user_id = p_clerk_user_id;
  if existing_id is not null then
    update app.profiles set display_name = left(coalesce(nullif(btrim(p_display_name), ''), display_name), 100),
      avatar_url = nullif(p_avatar_url, ''), updated_at = now() where id = existing_id;
    return existing_id;
  end if;
  base_handle := lower(regexp_replace(coalesce(p_requested_handle, ''), '[^a-zA-Z0-9-]+', '-', 'g'));
  base_handle := regexp_replace(left(regexp_replace(base_handle, '(^-+|-+$)', '', 'g'), 30), '-+$', '');
  if base_handle = '' then base_handle := 'user'; end if;
  for attempt in 0..4 loop
    candidate_handle := base_handle;
    if attempt > 0 or base_handle = any(array['admin','administrator','support','superii','super-ii','moderator','security','system']) then
      candidate_handle := left(base_handle, 29) || '-' || substr(encode(digest(p_clerk_user_id || case when attempt > 1 then ':' || attempt::text else '' end, 'sha256'), 'hex'), 1, 8);
    end if;
    insert into app.profiles(clerk_user_id, handle, display_name, avatar_url)
      values (p_clerk_user_id, candidate_handle, left(coalesce(nullif(btrim(p_display_name), ''), candidate_handle), 100), nullif(p_avatar_url, ''))
      on conflict do nothing returning id into existing_id;
    if existing_id is not null then return existing_id; end if;
    select id into existing_id from app.profiles where clerk_user_id = p_clerk_user_id;
    if existing_id is not null then return existing_id; end if;
  end loop;
  raise exception 'profile_handle_unavailable' using errcode = '23505';
end $$;

-- Counters only. There is no event log, URL, handle, account, IP or visitor ID.
create table if not exists app_private.experience_daily (
  day date not null default (now() at time zone 'UTC')::date,
  event text not null check (event in ('page_open','handle_open','handle_check','signup_open','workspace_open','resource_open','download_click','handle_error')),
  surface text not null check (surface in ('home','models','datasets','apps','robots','sigma','signup','workspace')),
  locale text not null check (locale in ('en','ru','zh-CN')),
  total bigint not null default 1 check (total > 0),
  primary key(day,event,surface,locale)
);
alter table app_private.experience_daily enable row level security;
revoke all on app_private.experience_daily from public, superii_web_backend, superii_payment_backend, superii_publishing_backend, superii_runtime_backend;

create or replace function app.prune_experience_events()
returns void language plpgsql security definer set search_path = app_private, app, pg_catalog as $$
begin
  if not app.context_is_verified() or app.current_context_service() <> 'web' then raise insufficient_privilege; end if;
  delete from app_private.experience_daily where day <= (now() at time zone 'UTC')::date - 90;
end $$;
create or replace function app.record_experience_event(p_event text, p_surface text, p_locale text)
returns void language plpgsql security definer set search_path = app_private, app, pg_catalog as $$
begin
  if not app.context_is_verified() or app.current_context_service() <> 'web' then raise insufficient_privilege; end if;
  if (p_event like 'handle_%' and p_surface <> 'home')
    or (p_event = 'signup_open' and p_surface <> 'signup')
    or (p_event = 'workspace_open' and p_surface <> 'workspace')
    or (p_event in ('resource_open','download_click') and p_surface not in ('models','datasets','apps','robots','sigma')) then
    raise exception 'invalid_experience_event' using errcode = '22023';
  end if;
  perform app.prune_experience_events();
  insert into app_private.experience_daily(event,surface,locale) values(p_event,p_surface,p_locale)
    on conflict(day,event,surface,locale) do update set total = app_private.experience_daily.total + 1;
end $$;
create or replace function app.experience_report()
returns table(day date,event text,surface text,locale text,total bigint)
language plpgsql security definer set search_path = app_private, app, pg_catalog as $$
begin
  if not app.context_is_verified() or not app.context_is_admin() then raise insufficient_privilege; end if;
  return query select d.day,d.event,d.surface,d.locale,d.total from app_private.experience_daily d
    where d.day > (now() at time zone 'UTC')::date - 90 order by d.day desc,d.event,d.surface,d.locale;
end $$;
revoke all on function app.prune_experience_events(), app.record_experience_event(text,text,text), app.experience_report() from public;
grant execute on function app.prune_experience_events(), app.record_experience_event(text,text,text), app.experience_report() to superii_web_backend;

commit;

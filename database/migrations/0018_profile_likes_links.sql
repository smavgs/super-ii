begin;

alter table app.profiles
  add column if not exists interests jsonb not null default '[]'::jsonb,
  add column if not exists x_username text,
  add column if not exists github_username text,
  add column if not exists linkedin_url text,
  add column if not exists website_url text,
  add column if not exists youtube_url text;

create or replace function app.profile_interests_are_valid(p_value jsonb)
returns boolean
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select case
    when jsonb_typeof(p_value) <> 'array' then false
    when jsonb_array_length(p_value) > 12 then false
    when octet_length(p_value::text) > 1200 then false
    else not exists (
      select 1
      from jsonb_array_elements(p_value) as interest(value)
      where jsonb_typeof(interest.value) <> 'string'
        or char_length(btrim(interest.value #>> '{}')) not between 1 and 80
    )
    and not exists (
      select 1
      from jsonb_array_elements_text(p_value) as interest(value)
      group by lower(btrim(interest.value))
      having count(*) > 1
    )
  end
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_bio_length'
      and conrelid = 'app.profiles'::regclass
  ) then
    alter table app.profiles
      add constraint profiles_bio_length
      check (bio is null or char_length(bio) <= 500) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_interests_shape'
      and conrelid = 'app.profiles'::regclass
  ) then
    alter table app.profiles
      add constraint profiles_interests_shape
      check (app.profile_interests_are_valid(interests));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_x_username_shape'
      and conrelid = 'app.profiles'::regclass
  ) then
    alter table app.profiles
      add constraint profiles_x_username_shape
      check (
        x_username is null
        or (
          x_username = btrim(x_username)
          and char_length(x_username) between 1 and 50
          and x_username ~ '^[A-Za-z0-9_]+$'
        )
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_github_username_shape'
      and conrelid = 'app.profiles'::regclass
  ) then
    alter table app.profiles
      add constraint profiles_github_username_shape
      check (
        github_username is null
        or (
          github_username = btrim(github_username)
          and char_length(github_username) between 1 and 39
          and github_username ~ '^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$'
        )
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_linkedin_url_shape'
      and conrelid = 'app.profiles'::regclass
  ) then
    alter table app.profiles
      add constraint profiles_linkedin_url_shape
      check (
        linkedin_url is null
        or (
          char_length(linkedin_url) <= 2048
          and linkedin_url ~ '^https://([A-Za-z0-9-]+\.)*linkedin\.com(?:/|\?|#|$)[^[:space:]]*$'
        )
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_website_url_shape'
      and conrelid = 'app.profiles'::regclass
  ) then
    alter table app.profiles
      add constraint profiles_website_url_shape
      check (website_url is null or (char_length(website_url) <= 2048 and website_url ~ '^https://[^[:space:]]+$'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_youtube_url_shape'
      and conrelid = 'app.profiles'::regclass
  ) then
    alter table app.profiles
      add constraint profiles_youtube_url_shape
      check (
        youtube_url is null
        or (
          char_length(youtube_url) <= 2048
          and youtube_url ~ '^https://(?:([A-Za-z0-9-]+\.)*youtube\.com|youtu\.be)(?:/|\?|#|$)[^[:space:]]*$'
        )
      );
  end if;
end
$$;

create table if not exists app.profile_likes (
  liker_profile_id uuid not null references app.profiles(id) on delete cascade,
  liked_profile_id uuid not null references app.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (liker_profile_id, liked_profile_id),
  constraint profile_likes_not_self check (liker_profile_id <> liked_profile_id)
);

create index if not exists profile_likes_liked_created_idx
  on app.profile_likes (liked_profile_id, created_at desc);

create or replace function app.set_profile_like(
  p_liker_profile_id uuid,
  p_liked_profile_id uuid,
  p_active boolean
)
returns table(active boolean, likes_count integer)
language plpgsql
security invoker
set search_path = app, pg_catalog
as $$
begin
  if p_liker_profile_id = p_liked_profile_id then
    raise exception 'cannot_like_self' using errcode = '22023';
  end if;

  if not exists (
    select 1 from app.profiles
    where id = p_liker_profile_id
  ) then
    raise exception 'liker_profile_not_found' using errcode = 'P0002';
  end if;

  if not exists (
    select 1 from app.profiles
    where id = p_liked_profile_id and is_public = true
  ) then
    raise exception 'profile_not_found' using errcode = 'P0002';
  end if;

  if p_active then
    insert into app.profile_likes (liker_profile_id, liked_profile_id)
    values (p_liker_profile_id, p_liked_profile_id)
    on conflict do nothing;
  else
    delete from app.profile_likes
    where liker_profile_id = p_liker_profile_id
      and liked_profile_id = p_liked_profile_id;
  end if;

  return query
  select
    p_active,
    count(*)::integer
  from app.profile_likes profile_like
  where profile_like.liked_profile_id = p_liked_profile_id;
end;
$$;

alter table app.profile_likes enable row level security;

drop policy if exists profile_likes_public_read on app.profile_likes;
create policy profile_likes_public_read on app.profile_likes
for select using (
  exists (
    select 1 from app.profiles profile
    where profile.id = profile_likes.liked_profile_id and profile.is_public
  )
  and exists (
    select 1 from app.profiles profile
    where profile.id = profile_likes.liker_profile_id and profile.is_public
  )
);

commit;

begin;

do $$
declare
  liker_id constant uuid := 'a1700000-0000-4000-8000-000000000001';
  liked_id constant uuid := 'a1700000-0000-4000-8000-000000000002';
  result record;
begin
  insert into app.profiles (id, clerk_user_id, handle, display_name)
  values
    (liker_id, 'profile-like-liker', 'profile-like-liker', 'Profile Like Liker'),
    (liked_id, 'profile-like-liked', 'profile-like-liked', 'Profile Like Target');

  update app.profiles
  set bio = 'Building careful local AI tools.',
      interests = '["Local AI", "Agents", "Open models"]'::jsonb,
      x_username = 'superiisite',
      github_username = 'super-ii',
      linkedin_url = 'https://www.linkedin.com/in/super-ii/',
      website_url = 'https://superii.site/',
      youtube_url = 'https://www.youtube.com/@superii'
  where id = liked_id;

  if not exists (
    select 1 from app.profiles
    where id = liked_id
      and interests = '["Local AI", "Agents", "Open models"]'::jsonb
      and youtube_url = 'https://www.youtube.com/@superii'
  ) then
    raise exception 'Valid public profile details were not persisted';
  end if;

  begin
    update app.profiles set interests = '["Agents", "agents"]'::jsonb where id = liked_id;
    raise exception 'Duplicate interests were accepted';
  exception when check_violation then
    null;
  end;

  begin
    update app.profiles set linkedin_url = 'https://example.com/not-linkedin' where id = liked_id;
    raise exception 'A non-LinkedIn URL was accepted as LinkedIn';
  exception when check_violation then
    null;
  end;

  begin
    update app.profiles set youtube_url = 'http://youtube.com/@unsafe' where id = liked_id;
    raise exception 'A non-HTTPS YouTube URL was accepted';
  exception when check_violation then
    null;
  end;

  select * into result from app.set_profile_like(liker_id, liked_id, true);
  if result.active is distinct from true or result.likes_count <> 1 then
    raise exception 'Profile like was not created exactly once';
  end if;

  select * into result from app.set_profile_like(liker_id, liked_id, true);
  if result.active is distinct from true or result.likes_count <> 1 then
    raise exception 'Profile like replay was not idempotent';
  end if;

  if (select count(*) from app.likes) <> 0 then
    raise exception 'Profile like changed the repository-like relation';
  end if;

  select * into result from app.set_profile_like(liker_id, liked_id, false);
  if result.active is distinct from false or result.likes_count <> 0 then
    raise exception 'Profile unlike did not remove the relation';
  end if;

  begin
    perform app.set_profile_like(liker_id, liker_id, true);
    raise exception 'Self-like was accepted';
  exception when sqlstate '22023' then
    null;
  end;

  update app.profiles set is_public = false where id = liked_id;
  begin
    perform app.set_profile_like(liker_id, liked_id, true);
    raise exception 'A private profile accepted a public profile like';
  exception when sqlstate 'P0002' then
    null;
  end;
end
$$;

rollback;

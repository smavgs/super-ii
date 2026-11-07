-- One reversible heart per member and story; counts never affect news ordering.
begin;
create table if not exists app.sigma_story_likes (
 story_id uuid not null references app.sigma_stories(id) on delete cascade,
 profile_id uuid not null references app.profiles(id) on delete cascade,
 created_at timestamptz not null default now(),
 primary key(story_id,profile_id)
);
alter table app.sigma_story_likes enable row level security;
revoke all on app.sigma_story_likes from public,superii_web_backend,superii_payment_backend,superii_publishing_backend,superii_runtime_backend;

create or replace function app.sigma_story_engagement(p_id uuid,p_active boolean default null)
returns jsonb language plpgsql security definer set search_path=app,pg_catalog as $$
declare actor uuid:=app.current_profile_id();
begin
 if not app.context_is_verified() or app.current_context_service()<>'web' then raise exception 'sigma_web_required'; end if;
 if not exists(select 1 from app.sigma_stories s join app.posts p on p.id=s.id and p.is_public
   join app.profiles author on author.id=p.author_profile_id and author.is_public where s.id=p_id and s.published is not null) then return null; end if;
 if p_active is not null then
  if app.current_actor_kind()<>'clerk' or actor is null then raise exception 'sigma_sign_in_required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_id::text,47));
  if p_active then insert into app.sigma_story_likes(story_id,profile_id) values(p_id,actor) on conflict do nothing;
  else delete from app.sigma_story_likes where story_id=p_id and profile_id=actor; end if;
 end if;
 return jsonb_build_object('likes_count',(select count(*) from app.sigma_story_likes where story_id=p_id),
  'liked',app.current_actor_kind()='clerk' and exists(select 1 from app.sigma_story_likes where story_id=p_id and profile_id=actor));
end $$;

create or replace function app.sigma_public_page(p_query text default '',p_topic text default '',p_page integer default 0,p_size integer default 3)
returns jsonb language sql stable security definer set search_path=app,pg_catalog as $$
 with options as (
  select left(trim(coalesce(p_query,'')),200) query,coalesce(p_topic,'') topic,
   greatest(coalesce(p_page,0),0) requested_page,least(greatest(coalesce(p_size,3),1),30) size
 ), matches as materialized (
  select s.id,s.published_at from app.sigma_stories s
  join app.posts p on p.id=s.id and p.is_public
  join app.profiles author on author.id=p.author_profile_id and author.is_public cross join options o
  where s.published is not null and (o.topic='' or s.published->>'category'=o.topic)
   and (o.query='' or position(lower(o.query) in lower(author.handle))>0 or exists(
    select 1 from jsonb_each(s.published->'translations') t where position(lower(o.query) in lower(
     coalesce(t.value->>'title','')||' '||coalesce(t.value->>'summary','')||' '||coalesce(t.value->>'body','')))>0))
 ), counts as (select count(*) total from matches), bounds as (
  select total,size,least(requested_page,greatest((total-1)/size,0)) page from counts cross join options
 ), selected as (
  select * from matches order by published_at desc,id
  limit (select size from bounds) offset (select page*size from bounds)
 ), stories as (
  select s.id,p.slug,author.handle::text owner,author.display_name owner_name,s.published_at,s.published document,
   (select count(*) from app.sigma_story_likes where story_id=s.id) likes_count,
   app.current_actor_kind()='clerk' and exists(select 1 from app.sigma_story_likes where story_id=s.id and profile_id=app.current_profile_id()) liked
  from selected chosen join app.sigma_stories s on s.id=chosen.id join app.posts p on p.id=s.id
  join app.profiles author on author.id=p.author_profile_id
 ) select jsonb_build_object('total',total,'page',page,'size',size,
  'stories',coalesce((select jsonb_agg(to_jsonb(stories) order by published_at desc,id) from stories),'[]'::jsonb)) from bounds
$$;

revoke all on function app.sigma_story_engagement(uuid,boolean),app.sigma_public_page(text,text,integer,integer)
 from public,superii_web_backend,superii_payment_backend,superii_publishing_backend,superii_runtime_backend;
grant execute on function app.sigma_story_engagement(uuid,boolean),app.sigma_public_page(text,text,integer,integer) to superii_web_backend;
commit;

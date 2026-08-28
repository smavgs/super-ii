begin;

create extension if not exists pg_trgm;

alter table app.repositories
  add column if not exists task text,
  add column if not exists library text,
  add column if not exists modality text,
  add column if not exists total_size_bytes bigint not null default 0,
  add column if not exists latest_revision_id uuid references app.repository_revisions(id) on delete set null,
  add column if not exists search_document tsvector generated always as (
    setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(summary, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(owner_handle, '') || ' ' || coalesce(slug, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(task, '') || ' ' || coalesce(library, '') || ' ' || coalesce(modality, '') || ' ' || coalesce(license, '')), 'C')
  ) stored;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'app.repositories'::regclass
      and conname = 'repositories_total_size_nonnegative'
  ) then
    alter table app.repositories
      add constraint repositories_total_size_nonnegative check (total_size_bytes >= 0);
  end if;
end
$$;

create index if not exists repositories_search_document_idx
  on app.repositories using gin (search_document);
create index if not exists repositories_title_trgm_idx
  on app.repositories using gin (title gin_trgm_ops);
create index if not exists repositories_summary_trgm_idx
  on app.repositories using gin (summary gin_trgm_ops);
create index if not exists repositories_discovery_filters_idx
  on app.repositories (kind, task, library, license, modality, total_size_bytes, updated_at desc)
  where visibility = 'public' and status = 'published';

create table if not exists app.repository_revision_analyses (
  id uuid primary key default gen_random_uuid(),
  repository_id uuid not null references app.repositories(id) on delete cascade,
  revision_id uuid not null,
  analysis_type text not null check (analysis_type in (
    'model', 'dataset', 'space', 'safetensors', 'tokenizer', 'gguf', 'diffusers'
  )),
  status text not null check (status in ('pending', 'running', 'passed', 'failed', 'error')),
  result jsonb not null default '{}'::jsonb check (jsonb_typeof(result) = 'object'),
  tool_versions jsonb not null default '{}'::jsonb check (jsonb_typeof(tool_versions) = 'object'),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (repository_id, revision_id)
    references app.repository_revisions(repository_id, id) on delete cascade,
  unique (revision_id, analysis_type)
);
create index if not exists repository_revision_analyses_repository_idx
  on app.repository_revision_analyses (repository_id, revision_id, analysis_type);

create table if not exists app.discussions (
  id uuid primary key default gen_random_uuid(),
  repository_id uuid not null references app.repositories(id) on delete cascade,
  author_profile_id uuid not null references app.profiles(id) on delete restrict,
  title text not null check (char_length(title) between 3 and 300),
  body text not null check (char_length(body) between 1 and 100000),
  status text not null default 'open' check (status in ('open', 'locked', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists discussions_repository_updated_idx
  on app.discussions (repository_id, updated_at desc);

create table if not exists app.discussion_comments (
  id uuid primary key default gen_random_uuid(),
  discussion_id uuid not null references app.discussions(id) on delete cascade,
  author_profile_id uuid not null references app.profiles(id) on delete restrict,
  parent_comment_id uuid references app.discussion_comments(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 100000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists discussion_comments_discussion_created_idx
  on app.discussion_comments (discussion_id, created_at);

create table if not exists app.reactions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references app.profiles(id) on delete cascade,
  target_type text not null check (target_type in ('discussion', 'comment')),
  target_id uuid not null,
  reaction text not null check (reaction in ('like', 'helpful', 'celebrate', 'heart', 'eyes')),
  created_at timestamptz not null default now(),
  unique (profile_id, target_type, target_id, reaction)
);
create index if not exists reactions_target_idx
  on app.reactions (target_type, target_id, created_at);

create table if not exists app.discussion_events (
  id uuid primary key default gen_random_uuid(),
  discussion_id uuid not null references app.discussions(id) on delete cascade,
  actor_profile_id uuid references app.profiles(id) on delete set null,
  event_type text not null check (event_type in (
    'created', 'commented', 'edited', 'locked', 'unlocked', 'closed', 'reopened', 'moderated'
  )),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);
create index if not exists discussion_events_discussion_created_idx
  on app.discussion_events (discussion_id, created_at);

create table if not exists app.likes (
  profile_id uuid not null references app.profiles(id) on delete cascade,
  repository_id uuid not null references app.repositories(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (profile_id, repository_id)
);
create index if not exists likes_repository_created_idx
  on app.likes (repository_id, created_at desc);

create table if not exists app.follows (
  follower_profile_id uuid not null references app.profiles(id) on delete cascade,
  followed_profile_id uuid not null references app.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_profile_id, followed_profile_id),
  constraint follows_not_self check (follower_profile_id <> followed_profile_id)
);
create index if not exists follows_followed_created_idx
  on app.follows (followed_profile_id, created_at desc);

create table if not exists app.repository_watchers (
  profile_id uuid not null references app.profiles(id) on delete cascade,
  repository_id uuid not null references app.repositories(id) on delete cascade,
  level text not null default 'releases' check (level in ('all', 'releases', 'discussions')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (profile_id, repository_id)
);
create index if not exists repository_watchers_repository_idx
  on app.repository_watchers (repository_id, created_at desc);

create table if not exists app.activity_events (
  id uuid primary key default gen_random_uuid(),
  actor_profile_id uuid references app.profiles(id) on delete set null,
  repository_id uuid references app.repositories(id) on delete cascade,
  event_type text not null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  is_public boolean not null default true,
  occurred_at timestamptz not null default now()
);
create index if not exists activity_events_public_created_idx
  on app.activity_events (occurred_at desc) where is_public = true;
create index if not exists activity_events_repository_created_idx
  on app.activity_events (repository_id, occurred_at desc);

create table if not exists app.collections (
  id uuid primary key default gen_random_uuid(),
  owner_profile_id uuid not null references app.profiles(id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9](?:[a-z0-9._-]{0,95}[a-z0-9])?$'),
  title text not null check (char_length(title) between 1 and 200),
  summary text not null default '' check (char_length(summary) <= 2000),
  visibility repository_visibility not null default 'public',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_profile_id, slug)
);
create index if not exists collections_public_updated_idx
  on app.collections (updated_at desc) where visibility = 'public';

create table if not exists app.collection_items (
  collection_id uuid not null references app.collections(id) on delete cascade,
  repository_id uuid not null references app.repositories(id) on delete cascade,
  position integer not null default 0 check (position >= 0),
  note text not null default '' check (char_length(note) <= 2000),
  added_at timestamptz not null default now(),
  primary key (collection_id, repository_id)
);
create index if not exists collection_items_order_idx
  on app.collection_items (collection_id, position, added_at);

create table if not exists app.repository_relationships (
  id uuid primary key default gen_random_uuid(),
  source_repository_id uuid not null references app.repositories(id) on delete cascade,
  target_repository_id uuid not null references app.repositories(id) on delete cascade,
  relationship_type text not null check (relationship_type in (
    'trained-on',
    'fine-tuned-from',
    'quantized-from',
    'converted-from',
    'uses-dataset',
    'used-by-app',
    'evaluated-on'
  )),
  source_revision_id uuid references app.repository_revisions(id) on delete set null,
  target_revision_id uuid references app.repository_revisions(id) on delete set null,
  evidence_url text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_by text not null,
  created_at timestamptz not null default now(),
  constraint repository_relationships_not_self check (source_repository_id <> target_repository_id),
  unique (source_repository_id, target_repository_id, relationship_type)
);
create index if not exists repository_relationships_source_idx
  on app.repository_relationships (source_repository_id, relationship_type);
create index if not exists repository_relationships_target_idx
  on app.repository_relationships (target_repository_id, relationship_type);

create or replace function app.validate_reaction_target()
returns trigger
language plpgsql
set search_path = app, pg_catalog
as $$
begin
  if new.target_type = 'discussion' and not exists (
    select 1 from app.discussions where id = new.target_id
  ) then
    raise exception 'reaction_discussion_not_found' using errcode = '23503';
  end if;
  if new.target_type = 'comment' and not exists (
    select 1 from app.discussion_comments where id = new.target_id
  ) then
    raise exception 'reaction_comment_not_found' using errcode = '23503';
  end if;
  return new;
end;
$$;

create or replace function app.sync_published_revision()
returns trigger
language plpgsql
set search_path = app, pg_catalog
as $$
begin
  if new.status = 'published' and old.status is distinct from 'published' then
    update app.repositories
    set latest_revision_id = new.id,
        total_size_bytes = new.total_size_bytes,
        updated_at = now()
    where id = new.repository_id;
  end if;
  return new;
end;
$$;

create or replace function app.search_public_repositories(
  p_query text default null,
  p_kind repository_kind default null,
  p_task text default null,
  p_library text default null,
  p_license text default null,
  p_modality text default null,
  p_author text default null,
  p_max_size_bytes bigint default null,
  p_updated_after timestamptz default null,
  p_limit integer default 24,
  p_offset integer default 0
)
returns table (
  repository_id uuid,
  kind repository_kind,
  owner_handle text,
  slug text,
  title text,
  summary text,
  license text,
  task text,
  library text,
  modality text,
  total_size_bytes bigint,
  updated_at timestamptz,
  rank real
)
language plpgsql
security invoker
stable
set search_path = app, pg_catalog, public
as $$
declare
  normalized_query text := nullif(btrim(p_query), '');
begin
  return query
  select
    r.id,
    r.kind,
    r.owner_handle,
    r.slug,
    r.title,
    r.summary,
    r.license,
    r.task,
    r.library,
    r.modality,
    r.total_size_bytes,
    r.updated_at,
    case
      when normalized_query is null then 0::real
      else greatest(
        ts_rank_cd(r.search_document, websearch_to_tsquery('simple', normalized_query)),
        similarity(r.title, normalized_query),
        similarity(r.summary, normalized_query)
      )::real
    end as rank
  from app.repositories r
  where r.visibility = 'public'
    and r.status = 'published'
    and (p_kind is null or r.kind = p_kind)
    and (p_task is null or r.task = p_task)
    and (p_library is null or r.library = p_library)
    and (p_license is null or r.license = p_license)
    and (p_modality is null or r.modality = p_modality)
    and (p_author is null or lower(r.owner_handle) = lower(p_author))
    and (p_max_size_bytes is null or r.total_size_bytes <= p_max_size_bytes)
    and (p_updated_after is null or r.updated_at >= p_updated_after)
    and (
      normalized_query is null
      or r.search_document @@ websearch_to_tsquery('simple', normalized_query)
      or similarity(r.title, normalized_query) > 0.15
      or similarity(r.summary, normalized_query) > 0.15
    )
  order by rank desc, r.updated_at desc, r.id
  limit least(greatest(p_limit, 1), 100)
  offset greatest(p_offset, 0);
end;
$$;

drop trigger if exists reactions_validate_target on app.reactions;
create trigger reactions_validate_target before insert or update on app.reactions
for each row execute function app.validate_reaction_target();

drop trigger if exists repository_revisions_sync_published on app.repository_revisions;
create trigger repository_revisions_sync_published after update of status on app.repository_revisions
for each row execute function app.sync_published_revision();

drop trigger if exists repository_revision_analyses_touch_updated_at on app.repository_revision_analyses;
create trigger repository_revision_analyses_touch_updated_at before update on app.repository_revision_analyses
for each row execute function app.touch_updated_at();
drop trigger if exists discussions_touch_updated_at on app.discussions;
create trigger discussions_touch_updated_at before update on app.discussions
for each row execute function app.touch_updated_at();
drop trigger if exists discussion_comments_touch_updated_at on app.discussion_comments;
create trigger discussion_comments_touch_updated_at before update on app.discussion_comments
for each row execute function app.touch_updated_at();
drop trigger if exists repository_watchers_touch_updated_at on app.repository_watchers;
create trigger repository_watchers_touch_updated_at before update on app.repository_watchers
for each row execute function app.touch_updated_at();
drop trigger if exists collections_touch_updated_at on app.collections;
create trigger collections_touch_updated_at before update on app.collections
for each row execute function app.touch_updated_at();

alter table app.repository_revision_analyses enable row level security;
alter table app.plans enable row level security;
alter table app.discussions enable row level security;
alter table app.discussion_comments enable row level security;
alter table app.reactions enable row level security;
alter table app.discussion_events enable row level security;
alter table app.likes enable row level security;
alter table app.follows enable row level security;
alter table app.repository_watchers enable row level security;
alter table app.activity_events enable row level security;
alter table app.collections enable row level security;
alter table app.collection_items enable row level security;
alter table app.repository_relationships enable row level security;

drop policy if exists plans_public_read on app.plans;
create policy plans_public_read on app.plans
for select using (is_public = true);

drop policy if exists repository_revision_analyses_public_read on app.repository_revision_analyses;
create policy repository_revision_analyses_public_read on app.repository_revision_analyses
for select using (
  status = 'passed'
  and exists (
    select 1 from app.repository_revisions rr
    join app.repositories r on r.id = rr.repository_id
    where rr.id = repository_revision_analyses.revision_id
      and rr.status = 'published'
      and r.visibility = 'public'
      and r.status = 'published'
  )
);

drop policy if exists discussions_public_read on app.discussions;
create policy discussions_public_read on app.discussions
for select using (
  exists (
    select 1 from app.repositories r
    where r.id = discussions.repository_id
      and r.visibility = 'public'
      and r.status = 'published'
  )
);

drop policy if exists discussion_comments_public_read on app.discussion_comments;
create policy discussion_comments_public_read on app.discussion_comments
for select using (
  exists (
    select 1 from app.discussions d
    join app.repositories r on r.id = d.repository_id
    where d.id = discussion_comments.discussion_id
      and r.visibility = 'public'
      and r.status = 'published'
  )
);

drop policy if exists reactions_public_read on app.reactions;
create policy reactions_public_read on app.reactions
for select using (
  (target_type = 'discussion' and exists (
    select 1 from app.discussions d
    join app.repositories r on r.id = d.repository_id
    where d.id = reactions.target_id and r.visibility = 'public' and r.status = 'published'
  ))
  or (target_type = 'comment' and exists (
    select 1 from app.discussion_comments c
    join app.discussions d on d.id = c.discussion_id
    join app.repositories r on r.id = d.repository_id
    where c.id = reactions.target_id and r.visibility = 'public' and r.status = 'published'
  ))
);

drop policy if exists discussion_events_public_read on app.discussion_events;
create policy discussion_events_public_read on app.discussion_events
for select using (
  exists (
    select 1 from app.discussions d
    join app.repositories r on r.id = d.repository_id
    where d.id = discussion_events.discussion_id
      and r.visibility = 'public'
      and r.status = 'published'
  )
);

drop policy if exists likes_public_read on app.likes;
create policy likes_public_read on app.likes
for select using (
  exists (
    select 1 from app.repositories r
    where r.id = likes.repository_id and r.visibility = 'public' and r.status = 'published'
  )
);

drop policy if exists follows_public_read on app.follows;
create policy follows_public_read on app.follows
for select using (
  exists (select 1 from app.profiles p where p.id = follows.follower_profile_id and p.is_public)
  and exists (select 1 from app.profiles p where p.id = follows.followed_profile_id and p.is_public)
);

drop policy if exists repository_watchers_public_read on app.repository_watchers;
create policy repository_watchers_public_read on app.repository_watchers
for select using (
  exists (
    select 1 from app.repositories r
    where r.id = repository_watchers.repository_id
      and r.visibility = 'public'
      and r.status = 'published'
  )
);

drop policy if exists activity_events_public_read on app.activity_events;
create policy activity_events_public_read on app.activity_events
for select using (is_public = true);

drop policy if exists collections_public_read on app.collections;
create policy collections_public_read on app.collections
for select using (visibility = 'public');

drop policy if exists collection_items_public_read on app.collection_items;
create policy collection_items_public_read on app.collection_items
for select using (
  exists (
    select 1 from app.collections c
    join app.repositories r on r.id = collection_items.repository_id
    where c.id = collection_items.collection_id
      and c.visibility = 'public'
      and r.visibility = 'public'
      and r.status = 'published'
  )
);

drop policy if exists repository_relationships_public_read on app.repository_relationships;
create policy repository_relationships_public_read on app.repository_relationships
for select using (
  exists (
    select 1 from app.repositories source_repository
    where source_repository.id = repository_relationships.source_repository_id
      and source_repository.visibility = 'public'
      and source_repository.status = 'published'
  )
  and exists (
    select 1 from app.repositories target_repository
    where target_repository.id = repository_relationships.target_repository_id
      and target_repository.visibility = 'public'
      and target_repository.status = 'published'
  )
);

commit;

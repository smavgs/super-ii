import { sqlClient } from './db';

export type PublicBuilder = {
  id: string;
  handle: string;
  display_name: string;
  bio: string | null;
  avatar_url: string | null;
  interests: string[];
  created_at: string;
  repositories_count: number;
  model_count: number;
  dataset_count: number;
  app_count: number;
  posts_count: number;
  proposals_count: number;
  likes_count: number;
  followers_count: number;
  last_active_at: string;
};

export type BuildersResult = {
  state: 'ok' | 'unconfigured' | 'error';
  builders: PublicBuilder[];
  query: string;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

const boundedInteger = (value: number, fallback: number, minimum: number, maximum: number) =>
  Number.isSafeInteger(value) ? Math.min(Math.max(value, minimum), maximum) : fallback;

export async function getPublicBuilders(
  locals: App.Locals,
  requestedQuery = '',
  requestedPage = 1,
  requestedPageSize = 48,
): Promise<BuildersResult> {
  const query = requestedQuery.trim().slice(0, 80);
  const pageSize = boundedInteger(requestedPageSize, 48, 1, 60);
  const sql = sqlClient(locals);
  const unavailable = (state: 'unconfigured' | 'error'): BuildersResult => ({
    state,
    builders: [],
    query,
    page: 1,
    pageSize,
    total: 0,
    totalPages: 1,
  });
  if (!sql) return unavailable('unconfigured');

  try {
    const totalRows = await sql`
      select count(*)::integer as total
      from app.profiles profile
      where profile.is_public
        and (
          ${query} = ''
          or position(lower(${query}) in lower(concat_ws(
            ' ', profile.handle, profile.display_name, coalesce(profile.bio, ''), coalesce(profile.interests::text, '')
          ))) > 0
        )
    `;
    const total = Number(totalRows[0]?.total ?? 0);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(boundedInteger(requestedPage, 1, 1, 1000), totalPages);
    const offset = (page - 1) * pageSize;

    const rows = await sql`
      with repository_counts as (
        select repository.owner_profile_id as profile_id,
               count(*)::integer as repositories_count,
               count(*) filter (where repository.kind = 'model')::integer as model_count,
               count(*) filter (where repository.kind = 'dataset')::integer as dataset_count,
               count(*) filter (where repository.kind = 'space')::integer as app_count,
               max(repository.updated_at) as last_activity
        from app.repositories repository
        where repository.owner_profile_id is not null
          and repository.visibility = 'public' and repository.status = 'published'
        group by repository.owner_profile_id
      ), post_counts as (
        select post.author_profile_id as profile_id, count(*)::integer as posts_count,
               max(post.updated_at) as last_activity
        from app.posts post where post.is_public group by post.author_profile_id
      ), proposal_counts as (
        select proposal.proposer_profile_id as profile_id, count(*)::integer as proposals_count,
               max(proposal.updated_at) as last_activity
        from app.proposals proposal where proposal.status <> 'removed' group by proposal.proposer_profile_id
      ), profile_like_counts as (
        select profile_like.liked_profile_id as profile_id, count(*)::integer as likes_count
        from app.profile_likes profile_like group by profile_like.liked_profile_id
      ), follower_counts as (
        select follow.followed_profile_id as profile_id, count(*)::integer as followers_count
        from app.follows follow group by follow.followed_profile_id
      )
      select profile.id, profile.handle, profile.display_name, profile.bio, profile.avatar_url,
             profile.interests, profile.created_at,
             coalesce(repository_counts.repositories_count, 0)::integer as repositories_count,
             coalesce(repository_counts.model_count, 0)::integer as model_count,
             coalesce(repository_counts.dataset_count, 0)::integer as dataset_count,
             coalesce(repository_counts.app_count, 0)::integer as app_count,
             coalesce(post_counts.posts_count, 0)::integer as posts_count,
             coalesce(proposal_counts.proposals_count, 0)::integer as proposals_count,
             coalesce(profile_like_counts.likes_count, 0)::integer as likes_count,
             coalesce(follower_counts.followers_count, 0)::integer as followers_count,
             greatest(
               profile.updated_at,
               coalesce(repository_counts.last_activity, profile.created_at),
               coalesce(post_counts.last_activity, profile.created_at),
               coalesce(proposal_counts.last_activity, profile.created_at)
             ) as last_active_at
      from app.profiles profile
      left join repository_counts on repository_counts.profile_id = profile.id
      left join post_counts on post_counts.profile_id = profile.id
      left join proposal_counts on proposal_counts.profile_id = profile.id
      left join profile_like_counts on profile_like_counts.profile_id = profile.id
      left join follower_counts on follower_counts.profile_id = profile.id
      where profile.is_public
        and (
          ${query} = ''
          or position(lower(${query}) in lower(concat_ws(
            ' ', profile.handle, profile.display_name, coalesce(profile.bio, ''), coalesce(profile.interests::text, '')
          ))) > 0
        )
      order by
        ((coalesce(repository_counts.repositories_count, 0) + coalesce(post_counts.posts_count, 0)
          + coalesce(proposal_counts.proposals_count, 0)) > 0) desc,
        last_active_at desc,
        lower(profile.display_name), lower(profile.handle)
      limit ${pageSize} offset ${offset}
    `;

    const builders = rows.map((row) => ({
      ...row,
      interests: Array.isArray(row.interests) ? row.interests.map(String) : [],
      repositories_count: Number(row.repositories_count ?? 0),
      model_count: Number(row.model_count ?? 0),
      dataset_count: Number(row.dataset_count ?? 0),
      app_count: Number(row.app_count ?? 0),
      posts_count: Number(row.posts_count ?? 0),
      proposals_count: Number(row.proposals_count ?? 0),
      likes_count: Number(row.likes_count ?? 0),
      followers_count: Number(row.followers_count ?? 0),
    })) as PublicBuilder[];

    return { state: 'ok', builders, query, page, pageSize, total, totalPages };
  } catch {
    return unavailable('error');
  }
}

import { sqlClient } from './db';
import type { RepositoryKind } from './catalog';

export type PublicPaper = {
  id: string;
  owner: string;
  slug: string;
  title: string;
  abstract: string;
  canonical_url: string | null;
  doi: string | null;
  published_on: string | null;
  created_at: string;
  repositories: Array<{
    kind: RepositoryKind;
    owner_handle: string;
    slug: string;
    title: string;
    relationship_type: string;
  }>;
};

export async function searchPublicPapers(
  locals: App.Locals,
  query = '',
  limit = 20,
): Promise<{ state: 'ok' | 'unconfigured' | 'error'; papers: PublicPaper[] }> {
  const sql = sqlClient(locals);
  if (!sql) return { state: 'unconfigured', papers: [] };
  const normalized = query.trim().slice(0, 300);
  try {
    const rows = await sql`
      select paper.id, profile.handle as owner, paper.slug, paper.title, paper.abstract,
             paper.canonical_url, paper.doi, paper.published_on, paper.created_at,
             coalesce((
               select jsonb_agg(jsonb_build_object(
                 'kind', repository.kind,
                 'owner_handle', repository.owner_handle,
                 'slug', repository.slug,
                 'title', repository.title,
                 'relationship_type', link.relationship_type
               ) order by link.relationship_type, repository.owner_handle, repository.slug)
               from app.paper_repository_links link
               join app.repositories repository on repository.id = link.repository_id
               where link.paper_id = paper.id
                 and repository.visibility = 'public'
                 and repository.status = 'published'
             ), '[]'::jsonb) as repositories
      from app.papers paper
      join app.profiles profile on profile.id = paper.owner_profile_id
      where paper.is_public
        and (
          ${normalized} = ''
          or to_tsvector('english', paper.title || ' ' || paper.abstract) @@ websearch_to_tsquery('english', ${normalized})
          or paper.title % ${normalized}
          or coalesce(paper.doi, '') ilike '%' || ${normalized} || '%'
        )
      order by
        case when ${normalized} <> '' then ts_rank_cd(
          to_tsvector('english', paper.title || ' ' || paper.abstract),
          websearch_to_tsquery('english', ${normalized})
        ) end desc nulls last,
        coalesce(paper.published_on::timestamptz, paper.created_at) desc
      limit ${Math.min(Math.max(limit, 1), 100)}
    `;
    return { state: 'ok', papers: rows as PublicPaper[] };
  } catch {
    return { state: 'error', papers: [] };
  }
}

export async function getPublicPaper(
  locals: App.Locals,
  owner: string,
  slug: string,
): Promise<{ state: 'ok' | 'unconfigured' | 'error' | 'not_found'; paper: PublicPaper | null }> {
  const sql = sqlClient(locals);
  if (!sql) return { state: 'unconfigured', paper: null };
  try {
    const rows = await sql`
      select paper.id, profile.handle as owner, paper.slug, paper.title, paper.abstract,
             paper.canonical_url, paper.doi, paper.published_on, paper.created_at,
             coalesce((
               select jsonb_agg(jsonb_build_object(
                 'kind', repository.kind,
                 'owner_handle', repository.owner_handle,
                 'slug', repository.slug,
                 'title', repository.title,
                 'relationship_type', link.relationship_type
               ) order by link.relationship_type, repository.owner_handle, repository.slug)
               from app.paper_repository_links link
               join app.repositories repository on repository.id = link.repository_id
               where link.paper_id = paper.id
                 and repository.visibility = 'public'
                 and repository.status = 'published'
             ), '[]'::jsonb) as repositories
      from app.papers paper
      join app.profiles profile on profile.id = paper.owner_profile_id
      where paper.is_public
        and lower(profile.handle) = lower(${owner.slice(0, 120)})
        and lower(paper.slug) = lower(${slug.slice(0, 96)})
      limit 1
    `;
    const paper = (rows[0] as PublicPaper | undefined) ?? null;
    return { state: paper ? 'ok' : 'not_found', paper };
  } catch {
    return { state: 'error', paper: null };
  }
}

export function paperDocument(paper: PublicPaper, origin: string) {
  const url = new URL(`/papers/${encodeURIComponent(paper.owner)}/${encodeURIComponent(paper.slug)}`, origin).toString();
  return {
    schema: 'https://superii.site/schemas/paper-v1.json',
    id: paper.id,
    owner: paper.owner,
    slug: paper.slug,
    title: paper.title,
    abstract: paper.abstract,
    canonical_url: paper.canonical_url,
    doi: paper.doi,
    published_on: paper.published_on,
    url,
    repositories: paper.repositories.map((repository) => ({
      ...repository,
      url: new URL(
        `/${repository.kind === 'model' ? 'models' : repository.kind === 'dataset' ? 'datasets' : 'spaces'}/${encodeURIComponent(repository.owner_handle)}/${encodeURIComponent(repository.slug)}`,
        origin,
      ).toString(),
    })),
  };
}

export function paperMarkdown(paper: PublicPaper, origin: string): string {
  const document = paperDocument(paper, origin);
  const links = document.repositories.length
    ? document.repositories.map((repository) => `- ${repository.relationship_type}: [${repository.title}](${repository.url})`).join('\n')
    : '- No reviewed public repository is linked yet.';
  return `# ${paper.title}\n\n${paper.abstract}\n\n- Author: @${paper.owner}\n- DOI: ${paper.doi ?? 'not declared'}\n- Published: ${paper.published_on ?? 'not declared'}\n- Canonical source: ${paper.canonical_url ?? 'not declared'}\n\n## Connected repositories\n\n${links}\n`;
}

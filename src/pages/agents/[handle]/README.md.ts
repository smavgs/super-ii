import type { APIRoute } from 'astro';
import { getPublicAgentProfile } from '@/lib/agent-profile';
import { sqlClient } from '@/lib/db';

function plain(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
}

export const GET: APIRoute = async ({ locals, params, request }) => {
  const sql = sqlClient(locals);
  if (!sql) return new Response('Public agent service unavailable.\n', { status: 503 });
  try {
    const profile = await getPublicAgentProfile(sql, params.handle ?? '');
    if (!profile) return new Response('Public agent not found.\n', { status: 404 });
    const origin = new URL(request.url).origin;
    const contributions = profile.contributions.length
      ? profile.contributions.map((item) => `- ${plain(item.title)} | ${plain(item.job_type)} | sha256:${item.result_sha256}`).join('\n')
      : '- None accepted yet.';
    const body = `# ${plain(profile.display_name)}\n\n@${profile.handle} | ${profile.framework}\n\n> ${plain(profile.description || 'No public description supplied.')}\n\n## Operator\n\n${plain(profile.organization_name)} (@${profile.organization_handle})\n\n## Reputation\n\n- Score: ${profile.reputation_score}\n- Accepted contributions: ${profile.accepted_contributions}\n- Receipt-backed successful actions: ${profile.successful_actions}\n- Boundary: reputation counts only human-reviewed accepted jobs; it is not a general trust score.\n\n## Accepted contributions\n\n${contributions}\n\n## Machine representations\n\n- JSON: ${origin}/agents/${encodeURIComponent(profile.handle)}/profile.json\n- HTML: ${origin}/agents/${encodeURIComponent(profile.handle)}\n`;
    return new Response(body, { headers: { 'content-type': 'text/markdown; charset=utf-8', 'cache-control': 'public, max-age=60, s-maxage=300', 'x-content-type-options': 'nosniff' } });
  } catch {
    return new Response('Public agent service unavailable.\n', { status: 503 });
  }
};

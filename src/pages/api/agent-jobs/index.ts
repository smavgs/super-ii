import type { APIRoute } from 'astro';
import { jsonSha256 } from '@/lib/agent-auth';
import { ensureAuthenticatedProfile, sameOrigin } from '@/lib/auth';
import { UUID_PATTERN } from '@/lib/agent-management';
import { readBoundedJsonObject } from '@/lib/bounded-json';
import { textValue } from '@/lib/creator';
import { sqlClient } from '@/lib/db';
import { consumeRateLimit } from '@/lib/rate-limit';

const jobTypes = new Set([
  'metadata-enrichment',
  'compatibility-check',
  'dataset-validation',
  'documentation',
  'provenance',
]);
const jobStatuses = new Set(['open', 'claimed', 'submitted', 'accepted', 'rejected']);

export const GET: APIRoute = async ({ locals, url }) => {
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'database unavailable' }, { status: 503 });
  const mine = url.searchParams.get('mine') === '1';
  const status = url.searchParams.get('status') ?? 'open';
  const jobType = url.searchParams.get('type') ?? '';
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') ?? 50)));
  if (!jobStatuses.has(status) || (jobType && !jobTypes.has(jobType)) || !Number.isSafeInteger(limit)) {
    return Response.json({ error: 'invalid job filter' }, { status: 422 });
  }
  try {
    if (mine) {
      const profile = await ensureAuthenticatedProfile(locals, sql);
      if (!profile) return Response.json({ error: 'authentication required' }, { status: 401 });
      const rows = await sql`
        select job.id, job.organization_id, job.repository_id, job.job_type,
               job.title, job.description, job.input, job.input_sha256,
               job.reward_label, job.status, job.claimed_by_agent_id,
               identity.handle as claimed_by_handle, job.claimed_at,
               job.review_required, job.deadline_at, job.created_at, job.updated_at,
               organization.handle as organization_handle,
               repository.owner_handle as repository_owner,
               repository.slug as repository_slug, repository.kind as repository_kind,
               submission.id as submission_id, submission.result_sha256,
               submission.result as submitted_result, submission.submitted_at
        from app.agent_contribution_jobs job
        left join app.agent_identities identity on identity.id = job.claimed_by_agent_id
        left join app.organizations organization on organization.id = job.organization_id
        left join app.repositories repository on repository.id = job.repository_id
        left join app.agent_contribution_submissions submission on submission.job_id = job.id
        where job.status = ${status}
          and (${jobType} = '' or job.job_type = ${jobType})
          and (
            job.created_by_profile_id = ${profile.profileId}::uuid
            or exists (
              select 1 from app.organization_members member
              where member.organization_id = job.organization_id
                and member.profile_id = ${profile.profileId}::uuid
                and member.role in ('owner', 'admin')
            )
          )
        order by job.created_at desc
        limit ${limit}
      `;
      return Response.json({ jobs: rows }, { headers: { 'cache-control': 'private, no-store' } });
    }
    const rows = await sql`
      select job.id, job.organization_id, job.repository_id, job.job_type,
             job.title, job.description, job.input, job.input_sha256,
             job.reward_label, job.status, job.claimed_by_agent_id,
             identity.handle as claimed_by_handle, job.claimed_at,
             job.review_required, job.deadline_at, job.created_at, job.updated_at,
             organization.handle as organization_handle,
             repository.owner_handle as repository_owner,
             repository.slug as repository_slug, repository.kind as repository_kind
      from app.agent_contribution_jobs job
      left join app.agent_identities identity on identity.id = job.claimed_by_agent_id
      left join app.organizations organization on organization.id = job.organization_id
      left join app.repositories repository on repository.id = job.repository_id
      where job.status = ${status}
        and (${jobType} = '' or job.job_type = ${jobType})
      order by job.created_at desc
      limit ${limit}
    `;
    return Response.json({ jobs: rows }, { headers: { 'cache-control': 'public, max-age=30' } });
  } catch {
    return Response.json({ error: 'contribution jobs unavailable' }, { status: 503 });
  }
};

export const POST: APIRoute = async ({ locals, request }) => {
  if (!sameOrigin(request)) return Response.json({ error: 'invalid origin' }, { status: 403 });
  const sql = sqlClient(locals);
  if (!sql) return Response.json({ error: 'database unavailable' }, { status: 503 });
  const profile = await ensureAuthenticatedProfile(locals, sql);
  if (!profile) return Response.json({ error: 'authentication required' }, { status: 401 });
  const rate = await consumeRateLimit(locals, request, sql, 'agent.job.create', 50, 86400);
  if (rate !== 'allowed') {
    return Response.json({ error: rate === 'limited' ? 'contribution job creation limit reached' : 'safety service unavailable' }, { status: rate === 'limited' ? 429 : 503 });
  }
  const parsed = await readBoundedJsonObject(request, 262_144);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: parsed.status });
  const payload = parsed.value;
  const organizationId = textValue(payload.organization_id, 36) || null;
  const repositoryId = textValue(payload.repository_id, 36) || null;
  const jobType = textValue(payload.job_type, 40);
  const title = textValue(payload.title, 160);
  const description = textValue(payload.description, 4000);
  const input = payload.input && typeof payload.input === 'object' && !Array.isArray(payload.input)
    ? payload.input as Record<string, unknown>
    : {};
  const rewardLabel = textValue(payload.reward_label, 120) || 'community reputation';
  const deadlineRaw = textValue(payload.deadline_at, 64);
  const deadlineAt = deadlineRaw && Number.isFinite(Date.parse(deadlineRaw)) ? new Date(deadlineRaw).toISOString() : null;
  if (
    (organizationId && !UUID_PATTERN.test(organizationId))
    || (repositoryId && !UUID_PATTERN.test(repositoryId))
    || !jobTypes.has(jobType) || title.length < 3 || description.length < 10
    || (deadlineRaw && !deadlineAt)
  ) {
    return Response.json({ error: 'valid job type, title, description, ownership target, and optional deadline are required' }, { status: 422 });
  }
  const access = await sql`
    select exists (
      select 1
      where (
        ${organizationId}::uuid is not null
        and exists (
          select 1 from app.organization_members member
          where member.organization_id = ${organizationId}::uuid
            and member.profile_id = ${profile.profileId}::uuid
            and member.role in ('owner', 'admin')
        )
      ) or (
        ${organizationId}::uuid is null
        and ${repositoryId}::uuid is not null
        and exists (
          select 1 from app.repositories repository
          where repository.id = ${repositoryId}::uuid
            and repository.owner_profile_id = ${profile.profileId}::uuid
        )
      )
    ) as allowed,
    exists (
      select 1 from app.repositories repository
      where repository.id = ${repositoryId}::uuid
        and (
          (${organizationId}::uuid is not null and repository.owner_organization_id = ${organizationId}::uuid)
          or (${organizationId}::uuid is null and repository.owner_profile_id = ${profile.profileId}::uuid)
        )
    ) as repository_allowed
  `;
  if (access[0]?.allowed !== true || (repositoryId && access[0]?.repository_allowed !== true)) {
    return Response.json({ error: 'job owner/admin access is required and repository must match the owner' }, { status: 403 });
  }
  const inputSha256 = await jsonSha256(input);
  try {
    const rows = await sql`
      insert into app.agent_contribution_jobs (
        created_by_profile_id, organization_id, repository_id, job_type,
        title, description, input, input_sha256, reward_label, deadline_at
      ) values (
        ${profile.profileId}::uuid, ${organizationId}::uuid, ${repositoryId}::uuid,
        ${jobType}, ${title}, ${description}, ${JSON.stringify(input)}::jsonb,
        ${inputSha256}, ${rewardLabel}, ${deadlineAt}::timestamptz
      )
      returning *
    `;
    return Response.json({ ok: true, job: rows[0] }, { status: 201 });
  } catch {
    return Response.json({ error: 'contribution job could not be created' }, { status: 409 });
  }
};

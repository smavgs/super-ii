import type { NeonQueryFunction } from '@neondatabase/serverless';
import { compareTransparencyReports, type TransparencyReport } from './transparent';

export type TransparencyCommunity = {
  claim: null | { handle: string; display_name: string; avatar_url: string | null; verified_at: string };
  creator_responses: Array<{ id: string; response_type: string; body: string; evidence_urls: string[]; created_at: string; handle: string }>;
};

export type PublicTransparencyReport = TransparencyReport & { community: TransparencyCommunity };

function normalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, normalizeJson(item)]));
  }
  return typeof value === 'number' && !Number.isFinite(value) ? null : value;
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function asReport(value: unknown): TransparencyReport | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const report = value as TransparencyReport;
  return /^[a-f0-9]{64}$/.test(report.report_key ?? '') && Array.isArray(report.evidence) ? report : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export async function persistTransparencyReport(sql: NeonQueryFunction<false, false>, report: TransparencyReport): Promise<{ report: TransparencyReport; created: boolean }> {
  const canonical = JSON.stringify(normalizeJson(report));
  const snapshotHash = await sha256Hex(canonical);
  const rows = await sql`
    insert into app.transparency_reports (
      report_key, provider, repository_kind, repository_id, repository_owner,
      source_revision, requested_revision, criteria_version, snapshot,
      snapshot_sha256, checked_at
    ) values (
      ${report.report_key}, ${report.provider}, ${report.repository.kind}, ${report.repository.id},
      ${report.repository.owner}, ${report.repository.resolved_revision}, ${report.repository.requested_revision},
      ${report.criteria_version}, ${JSON.stringify(report)}::jsonb, ${snapshotHash}, ${report.checked_at}::timestamptz
    )
    on conflict (report_key) do nothing
    returning id, snapshot
  `;
  if (rows[0]?.snapshot) {
    await sql`select app.advance_transparency_watches(${String(rows[0].id)}::uuid)`;
    return { report: asReport(rows[0].snapshot) ?? report, created: true };
  }
  const existing = await sql`select id, snapshot from app.transparency_reports where report_key = ${report.report_key} limit 1`;
  const stored = asReport(existing[0]?.snapshot);
  if (!existing[0]?.id || !stored) throw new Error('transparency report persistence failed');
  // Retrying an already persisted check also retries watch advancement. That keeps
  // notification delivery recoverable if the original post-insert function failed.
  await sql`select app.advance_transparency_watches(${String(existing[0].id)}::uuid)`;
  return { report: stored, created: false };
}

export async function getTransparencyReport(sql: NeonQueryFunction<false, false>, reportKey: string): Promise<PublicTransparencyReport | null> {
  if (!/^[a-f0-9]{64}$/.test(reportKey)) return null;
  const rows = await sql`
    select report.id, report.snapshot,
           profile.handle as claim_handle, profile.display_name as claim_display_name,
           profile.avatar_url as claim_avatar_url, claim.verified_at as claim_verified_at
    from app.transparency_reports report
    left join app.transparency_repository_claims claim
      on claim.provider = report.provider
      and claim.repository_kind = report.repository_kind
      and lower(claim.repository_id) = lower(report.repository_id)
    left join app.profiles profile on profile.id = claim.profile_id and profile.is_public
    where report.report_key = ${reportKey}
    limit 1
  `;
  const row = rows[0];
  const report = asReport(row?.snapshot);
  if (!row?.id || !report) return null;
  const responses = await sql`
    select response.id, response.response_type, response.body, response.evidence_urls,
           response.created_at, profile.handle
    from app.transparency_creator_responses response
    join app.profiles profile on profile.id = response.profile_id
    where response.report_id = ${String(row.id)}::uuid
    order by response.created_at asc
    limit 50
  `;
  return {
    ...report,
    community: {
      claim: row.claim_handle ? {
        handle: String(row.claim_handle),
        display_name: String(row.claim_display_name),
        avatar_url: row.claim_avatar_url ? String(row.claim_avatar_url) : null,
        verified_at: String(row.claim_verified_at),
      } : null,
      creator_responses: responses.map((response) => ({
        id: String(response.id), response_type: String(response.response_type), body: String(response.body),
        evidence_urls: Array.isArray(response.evidence_urls) ? response.evidence_urls.map(String) : [],
        created_at: String(response.created_at), handle: String(response.handle),
      })),
    },
  };
}

export async function searchTransparencyReports(sql: NeonQueryFunction<false, false>, input: { query?: string; kind?: string; limit?: number; offset?: number }) {
  const query = (input.query ?? '').trim().slice(0, 120);
  const kind = ['model', 'dataset', 'space'].includes(input.kind ?? '') ? input.kind! : null;
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 50);
  const offset = Math.min(Math.max(input.offset ?? 0, 0), 10_000);
  const rows = await sql`
    select report_key, repository_kind, repository_id, source_revision, criteria_version,
           checked_at, snapshot->'coverage' as coverage
    from app.transparency_reports
    where (${kind}::text is null or repository_kind = ${kind})
      and (${query} = '' or repository_id ilike ${`%${query}%`})
    order by checked_at desc
    limit ${limit} offset ${offset}
  `;
  return rows.map((row) => ({
    report_key: String(row.report_key), repository_kind: String(row.repository_kind), repository_id: String(row.repository_id),
    source_revision: String(row.source_revision), criteria_version: String(row.criteria_version), checked_at: String(row.checked_at),
    coverage: asRecord(row.coverage),
  }));
}

export async function compareStoredTransparencyReports(sql: NeonQueryFunction<false, false>, leftKey: string, rightKey: string) {
  const [left, right] = await Promise.all([getTransparencyReport(sql, leftKey), getTransparencyReport(sql, rightKey)]);
  if (!left || !right) return null;
  return compareTransparencyReports(left, right);
}

export async function setTransparencySaved(sql: NeonQueryFunction<false, false>, profileId: string, reportKey: string, saved: boolean) {
  const reportRows = await sql`select id from app.transparency_reports where report_key = ${reportKey} limit 1`;
  if (!reportRows[0]?.id) return false;
  if (saved) await sql`
    insert into app.transparency_report_saves (report_id, profile_id)
    values (${String(reportRows[0].id)}::uuid, ${profileId}::uuid)
    on conflict do nothing
  `;
  else await sql`delete from app.transparency_report_saves where report_id = ${String(reportRows[0].id)}::uuid and profile_id = ${profileId}::uuid`;
  return true;
}

export async function setTransparencyWatched(sql: NeonQueryFunction<false, false>, profileId: string, reportKey: string, watched: boolean) {
  const reportRows = await sql`
    select id, provider, repository_kind, repository_id, source_revision
    from app.transparency_reports where report_key = ${reportKey} limit 1
  `;
  if (!reportRows[0]?.id) return false;
  if (watched) {
    // A profile has one active baseline per repository. Switching the baseline
    // disables an older watch first so one new revision creates one notification.
    await sql`
      update app.transparency_report_watches watch
      set enabled = false, updated_at = now()
      from app.transparency_reports baseline
      where baseline.id = watch.report_id
        and watch.profile_id = ${profileId}::uuid
        and watch.enabled
        and watch.report_id <> ${String(reportRows[0].id)}::uuid
        and baseline.provider = ${String(reportRows[0].provider)}
        and baseline.repository_kind = ${String(reportRows[0].repository_kind)}
        and lower(baseline.repository_id) = lower(${String(reportRows[0].repository_id)})
    `;
    await sql`
      insert into app.transparency_report_watches (report_id, profile_id, last_seen_revision)
      values (${String(reportRows[0].id)}::uuid, ${profileId}::uuid, ${String(reportRows[0].source_revision)})
      on conflict (report_id, profile_id) do update set
        enabled = true,
        last_seen_revision = excluded.last_seen_revision,
        latest_report_id = null,
        latest_revision = null,
        last_checked_at = now(),
        updated_at = now()
    `;
  } else await sql`
    update app.transparency_report_watches set enabled = false, updated_at = now()
    where report_id = ${String(reportRows[0].id)}::uuid and profile_id = ${profileId}::uuid
  `;
  return true;
}

export async function claimTransparencyRepository(sql: NeonQueryFunction<false, false>, profileId: string, reportKey: string) {
  const reports = await sql`
    select id, provider, repository_kind, repository_id, repository_owner
    from app.transparency_reports where report_key = ${reportKey} limit 1
  `;
  const report = reports[0];
  if (!report?.id) return { ok: false as const, error: 'report not found' };
  const identities = await sql`
    select identity.id
    from app.external_identities identity
    where identity.profile_id = ${profileId}::uuid
      and identity.provider = 'huggingface'
      and identity.revoked_at is null
      and (
        lower(identity.provider_username) = lower(${String(report.repository_owner)})
        or exists (
          select 1 from app.namespace_claims namespace
          where namespace.external_identity_id = identity.id
            and namespace.provider = 'huggingface'
            and lower(namespace.provider_namespace) = lower(${String(report.repository_owner)})
            and namespace.status = 'verified'
        )
      )
    order by identity.last_verified_at desc
    limit 1
  `;
  if (!identities[0]?.id) return { ok: false as const, error: 'Connect the matching Hugging Face owner or verified organization in Bring My Work first.' };
  const claims = await sql`
    insert into app.transparency_repository_claims (
      provider, repository_kind, repository_id, repository_owner, profile_id,
      external_identity_id, verification_method
    ) values (
      ${String(report.provider)}, ${String(report.repository_kind)}, ${String(report.repository_id)},
      ${String(report.repository_owner)}, ${profileId}::uuid, ${String(identities[0].id)}::uuid,
      'huggingface-oauth-owner-match'
    )
    on conflict do nothing
    returning id
  `;
  if (claims[0]?.id) return { ok: true as const, claimId: String(claims[0].id) };
  const existing = await sql`
    select id, profile_id from app.transparency_repository_claims
    where provider = ${String(report.provider)} and repository_kind = ${String(report.repository_kind)}
      and lower(repository_id) = lower(${String(report.repository_id)}) limit 1
  `;
  return String(existing[0]?.profile_id ?? '') === profileId
    ? { ok: true as const, claimId: String(existing[0].id) }
    : { ok: false as const, error: 'This repository is already claimed by another verified Super ii profile.' };
}

export async function addTransparencyCreatorResponse(
  sql: NeonQueryFunction<false, false>, profileId: string, reportKey: string,
  input: { responseType: 'response' | 'correction'; body: string; evidenceUrls: string[] },
) {
  const rows = await sql`
    select report.id as report_id, claim.id as claim_id
    from app.transparency_reports report
    join app.transparency_repository_claims claim
      on claim.provider = report.provider and claim.repository_kind = report.repository_kind
      and lower(claim.repository_id) = lower(report.repository_id)
    where report.report_key = ${reportKey} and claim.profile_id = ${profileId}::uuid
    limit 1
  `;
  if (!rows[0]?.claim_id) return false;
  await sql`
    insert into app.transparency_creator_responses (
      report_id, repository_claim_id, profile_id, response_type, body, evidence_urls
    ) values (
      ${String(rows[0].report_id)}::uuid, ${String(rows[0].claim_id)}::uuid,
      ${profileId}::uuid, ${input.responseType}, ${input.body}, ${JSON.stringify(input.evidenceUrls)}::jsonb
    )
  `;
  return true;
}

export async function submitTransparencyEvidence(
  sql: NeonQueryFunction<false, false>, profileId: string, reportKey: string,
  input: { criterionId: string; note: string; sourceUrl: string },
) {
  const rows = await sql`select id from app.transparency_reports where report_key = ${reportKey} limit 1`;
  if (!rows[0]?.id) return false;
  await sql`
    insert into app.transparency_evidence_submissions (report_id, profile_id, criterion_id, note, source_url)
    values (${String(rows[0].id)}::uuid, ${profileId}::uuid, ${input.criterionId}, ${input.note}, ${input.sourceUrl})
  `;
  return true;
}

export async function listProfileTransparency(sql: NeonQueryFunction<false, false>, profileId: string) {
  const rows = await sql`
    select report.report_key, report.repository_kind, report.repository_id, report.source_revision,
           report.checked_at, report.snapshot->'coverage' as coverage,
           exists(select 1 from app.transparency_report_saves saved where saved.report_id = report.id and saved.profile_id = ${profileId}::uuid) as saved,
           coalesce((select watched.enabled from app.transparency_report_watches watched where watched.report_id = report.id and watched.profile_id = ${profileId}::uuid), false) as watched,
           exists(select 1 from app.transparency_repository_claims claim where claim.profile_id = ${profileId}::uuid and claim.provider = report.provider and claim.repository_kind = report.repository_kind and lower(claim.repository_id) = lower(report.repository_id)) as claimed
    from app.transparency_reports report
    where exists(select 1 from app.transparency_report_saves saved where saved.report_id = report.id and saved.profile_id = ${profileId}::uuid)
       or exists(select 1 from app.transparency_report_watches watched where watched.report_id = report.id and watched.profile_id = ${profileId}::uuid and watched.enabled)
       or exists(select 1 from app.transparency_repository_claims claim where claim.profile_id = ${profileId}::uuid and claim.provider = report.provider and claim.repository_kind = report.repository_kind and lower(claim.repository_id) = lower(report.repository_id))
    order by report.checked_at desc limit 100
  `;
  return rows.map((row) => ({
    report_key: String(row.report_key), repository_kind: String(row.repository_kind), repository_id: String(row.repository_id),
    source_revision: String(row.source_revision), checked_at: String(row.checked_at), coverage: asRecord(row.coverage),
    saved: row.saved === true, watched: row.watched === true, claimed: row.claimed === true,
  }));
}

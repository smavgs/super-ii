import type { NeonQueryFunction } from '@neondatabase/serverless';
import { hashCardToken, validCardToken } from './card-crypto';
import type { CardPublicSnapshot, VerifiedBadgeId } from './cards';
import { sqlClient } from './db';

export async function eligibleCardBadges(
  sql: NeonQueryFunction<false, false>,
  profileId: string,
): Promise<VerifiedBadgeId[]> {
  const rows = await sql`
    select
      exists(select 1 from app.fame_slots where profile_id = ${profileId}::uuid and status = 'active') as founding_200,
      exists(select 1 from app.proposal_leader_badges where profile_id = ${profileId}::uuid) as community_leader,
      exists(select 1 from app.repositories where owner_profile_id = ${profileId}::uuid and status = 'published') as publisher,
      exists(select 1 from app.agent_identities where created_by_profile_id = ${profileId}::uuid and status = 'active') as agent_builder,
      exists(select 1 from app.robots where owner_profile_id = ${profileId}::uuid and status = 'published') as robot_builder,
      exists(select 1 from app.transparency_evidence_submissions where profile_id = ${profileId}::uuid and status = 'accepted') as transparency_contributor,
      exists(select 1 from app.repositories where owner_profile_id = ${profileId}::uuid and status = 'published' and visibility = 'public') as open_source_builder
  `;
  const row = rows[0] as Record<string, unknown> | undefined;
  const badges: VerifiedBadgeId[] = [];
  for (const badge of [
    'founding_200', 'community_leader', 'publisher', 'agent_builder',
    'robot_builder', 'transparency_contributor', 'open_source_builder',
  ] as const) {
    if (row?.[badge] === true) badges.push(badge);
  }
  return badges;
}

export function isCardPublicSnapshot(value: unknown): value is CardPublicSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const snapshot = value as Record<string, unknown>;
  return snapshot.version === 1
    && typeof snapshot.card_id === 'string'
    && typeof snapshot.name === 'string'
    && Boolean(snapshot.identity_en && typeof snapshot.identity_en === 'object')
    && Array.isArray(snapshot.services)
    && Array.isArray(snapshot.verified_badges)
    && Array.isArray(snapshot.personal_badges);
}

export async function loadPublicCardByToken(locals: App.Locals, token: string): Promise<{
  cardId: string;
  snapshot: CardPublicSnapshot;
  revision: number;
  updatedAt: string;
} | null> {
  if (!validCardToken(token)) return null;
  const sql = sqlClient(locals);
  if (!sql) return null;
  const rows = await sql`select card_id, snapshot, revision, updated_at from app.resolve_public_card(${await hashCardToken(token)})`;
  const row = rows[0] as { card_id?: string; snapshot?: unknown; revision?: number; updated_at?: string } | undefined;
  if (!row?.card_id || !isCardPublicSnapshot(row.snapshot)) return null;
  return {
    cardId: row.card_id,
    snapshot: row.snapshot,
    revision: Number(row.revision ?? 1),
    updatedAt: String(row.updated_at ?? row.snapshot.published_at),
  };
}

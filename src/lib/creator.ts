import type { NeonQueryFunction } from '@neondatabase/serverless';
import { runtimeValue } from './db';

export type ManagedRepository = {
  id: string;
  kind: 'model' | 'dataset' | 'space';
  owner_handle: string;
  slug: string;
  title: string;
  summary: string;
  status: string;
  revision_id: string;
  revision_status: string;
  branch_id: string;
  branch_name: string;
};

export const repositorySlugPattern = /^[a-z0-9](?:[a-z0-9._-]{0,95}[a-z0-9])?$/;
export const repositoryPathPattern = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\\)(?!.*[\u0000-\u001f\u007f]).{1,1024}$/;

export function textValue(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export function optionalUrl(value: unknown): string | null {
  const raw = textValue(value, 2048);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export function safeRepositoryPath(value: unknown): string | null {
  const path = textValue(value, 1024).normalize('NFC');
  if (!repositoryPathPattern.test(path)) return null;
  const parts = path.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) return null;
  return path;
}

export async function managedRepository(
  sql: NeonQueryFunction<false, false>,
  repositoryId: string,
  profileId: string,
  branchId: string | null = null,
): Promise<ManagedRepository | null> {
  try {
    const rows = await sql`
      select
        r.id,
        r.kind,
        r.owner_handle,
        r.slug,
        r.title,
        r.summary,
        r.status,
        rr.id as revision_id,
        rr.status as revision_status,
        b.id as branch_id,
        b.name as branch_name
      from app.repositories r
      join app.repository_branches b
        on b.repository_id = r.id
        and (
          (${branchId}::uuid is null and b.is_default)
          or b.id = ${branchId}::uuid
        )
      join app.repository_revisions rr on rr.id = b.head_revision_id
      where r.id = ${repositoryId}::uuid
        and (
          r.owner_profile_id = ${profileId}::uuid
          or exists (
            select 1
            from app.organization_members m
            where m.organization_id = r.owner_organization_id
              and m.profile_id = ${profileId}::uuid
              and m.role in ('owner', 'admin', 'maintainer')
          )
        )
      limit 1
    `;
    return (rows[0] as ManagedRepository | undefined) ?? null;
  } catch {
    return null;
  }
}

export async function scopedManagedRepository(
  sql: NeonQueryFunction<false, false>,
  repositoryId: string,
  branchId: string | null = null,
): Promise<ManagedRepository | null> {
  try {
    const rows = await sql`
      select
        r.id,
        r.kind,
        r.owner_handle,
        r.slug,
        r.title,
        r.summary,
        r.status,
        rr.id as revision_id,
        rr.status as revision_status,
        b.id as branch_id,
        b.name as branch_name
      from app.repositories r
      join app.repository_branches b
        on b.repository_id = r.id
        and (
          (${branchId}::uuid is null and b.is_default)
          or b.id = ${branchId}::uuid
        )
      join app.repository_revisions rr on rr.id = b.head_revision_id
      where r.id = ${repositoryId}::uuid
      limit 1
    `;
    return (rows[0] as ManagedRepository | undefined) ?? null;
  } catch {
    return null;
  }
}

export function isPlatformAdmin(locals: App.Locals, clerkUserId: string): boolean {
  const configured = runtimeValue(locals, 'SUPERII_ADMIN_USER_IDS');
  if (!configured) return false;
  return configured.split(',').map((value) => value.trim()).filter(Boolean).includes(clerkUserId);
}

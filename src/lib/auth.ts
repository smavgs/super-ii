import type { NeonQueryFunction } from '@neondatabase/serverless';

export type AuthenticatedProfile = {
  clerkUserId: string;
  profileId: string;
};

export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  return Boolean(origin && origin === new URL(request.url).origin);
}

export async function ensureAuthenticatedProfile(
  locals: App.Locals,
  sql: NeonQueryFunction<false, false>,
): Promise<AuthenticatedProfile | null> {
  if (typeof locals.auth !== 'function' || typeof locals.currentUser !== 'function') return null;
  const authentication = locals.auth();
  const userId = 'userId' in authentication ? authentication.userId : null;
  if (!userId) return null;

  const user = await locals.currentUser();
  if (!user) return null;
  const primaryEmail = user.emailAddresses.find(
    (email) => email.id === user.primaryEmailAddressId,
  )?.emailAddress;
  const requestedHandle = user.username
    ?? primaryEmail?.split('@')[0]
    ?? `user-${userId.slice(-8)}`;
  const displayName = [user.firstName, user.lastName].filter(Boolean).join(' ')
    || user.username
    || requestedHandle;
  const rows = await sql`
    select app.ensure_profile(
      ${userId},
      ${requestedHandle},
      ${displayName},
      ${user.imageUrl ?? null}
    ) as profile_id
  `;
  const profileId = rows[0]?.profile_id;
  return profileId ? { clerkUserId: userId, profileId: String(profileId) } : null;
}

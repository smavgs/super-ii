import type { APIRoute } from 'astro';
import { ensureAuthenticatedProfile } from '@/lib/auth';
import { completeHuggingFaceOAuth } from '@/lib/bridge';
import { sqlClient } from '@/lib/db';

function redirectWith(url: URL, key: string, value: string): Response {
  const destination = new URL('/bring-my-work', url.origin);
  destination.searchParams.set(key, value);
  return Response.redirect(destination, 303);
}

export const GET: APIRoute = async ({ locals, request }) => {
  const url = new URL(request.url);
  const sql = sqlClient(locals);
  if (!sql) return redirectWith(url, 'bridge_error', 'unavailable');
  const profile = await ensureAuthenticatedProfile(locals, sql);
  if (!profile) {
    const destination = new URL('/sign-in', url.origin);
    destination.searchParams.set('redirect_url', '/bring-my-work');
    return Response.redirect(destination, 303);
  }
  const providerError = url.searchParams.get('error');
  if (providerError) return redirectWith(url, 'bridge_error', 'authorization_declined');
  const code = url.searchParams.get('code') ?? '';
  const state = url.searchParams.get('state') ?? '';
  try {
    const result = await completeHuggingFaceOAuth(locals, sql, profile.profileId, code, state);
    const destination = new URL(result.returnPath, url.origin);
    if (destination.origin !== url.origin) return redirectWith(url, 'bridge_error', 'invalid_return');
    destination.searchParams.set('connected', result.identity.provider_username);
    return Response.redirect(destination, 303);
  } catch {
    return redirectWith(url, 'bridge_error', 'connection_failed');
  }
};

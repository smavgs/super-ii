import type { APIRoute } from 'astro';
import { verifyArtifactTicket } from '@/lib/artifact-ticket';
import { runtimeValue } from '@/lib/db';
import { proxiedFileResponse, runtimeFetch } from '@/lib/runtime';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const GET: APIRoute = async ({ locals, params, request }) => {
  let authentication;
  try {
    authentication = typeof locals.auth === 'function' ? locals.auth() : null;
  } catch {
    return Response.json({ error: 'authentication service unavailable' }, { status: 503 });
  }
  const userId = authentication && 'userId' in authentication ? authentication.userId : null;
  if (!userId) return Response.json({ error: 'sign in to view generated artifacts' }, { status: 401 });
  const artifactId = params.artifactId ?? '';
  if (!UUID.test(artifactId)) return Response.json({ error: 'artifact not found' }, { status: 404 });
  const url = new URL(request.url);
  const expires = Number(url.searchParams.get('expires'));
  const signature = url.searchParams.get('signature') ?? '';
  const ticketSecret = runtimeValue(locals, 'CONTACT_HASH_SALT');
  if (
    !ticketSecret
    || !Number.isSafeInteger(expires)
    || !await verifyArtifactTicket(ticketSecret, userId, artifactId, expires, signature)
  ) {
    return Response.json({ error: 'artifact link is invalid or expired' }, { status: 403 });
  }
  const upstream = await runtimeFetch(locals, `/v1/artifacts/${artifactId}`);
  if (!upstream) return Response.json({ error: 'artifact runtime unavailable' }, { status: 503 });
  const response = proxiedFileResponse(upstream, false);
  response.headers.set('content-disposition', `inline; filename="superii-${artifactId}.png"`);
  response.headers.set('cache-control', 'private, no-store');
  return response;
};

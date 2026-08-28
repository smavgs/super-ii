import type { APIRoute } from 'astro';
import { runtimeValue, sqlClient } from '@/lib/db';

const allowedInterests = new Set([
  'creator',
  'pro',
  'team',
  'enterprise',
  'security',
  'privacy',
  'feedback',
]);

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function json(body: Record<string, unknown>, status: number, extraHeaders: HeadersInit = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
      ...extraHeaders,
    },
  });
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

async function digest(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export const POST: APIRoute = async ({ request, locals }) => {
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > 12_000) return json({ message: 'Message is too large.' }, 413);
  if (!request.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    return json({ message: 'Expected a JSON request.' }, 415);
  }

  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return json({ message: 'The request could not be read.' }, 400);
  }

  // Honeypot: return success without storing bot submissions.
  if (text(payload.website, 200)) return json({ ok: true }, 202);

  const name = text(payload.name, 100);
  const email = text(payload.email, 254).toLowerCase();
  const interest = text(payload.interest, 40);
  const message = text(payload.message, 4000);

  if (name.length < 2 || !emailPattern.test(email) || !allowedInterests.has(interest) || message.length < 10) {
    return json({ message: 'Please complete every field with a valid email and a little more detail.' }, 422);
  }

  const sql = sqlClient(locals);
  const salt = runtimeValue(locals, 'CONTACT_HASH_SALT');
  if (!sql || !salt) {
    return json({ message: 'The secure message service is not active yet. Please try again shortly.' }, 503, { 'retry-after': '300' });
  }

  const network = request.headers.get('cf-connecting-ip') || 'unknown';
  const networkHash = await digest(`${salt}:${network}`);
  const userAgent = text(request.headers.get('user-agent'), 500);

  try {
    const rows = await sql`
      select app.submit_contact(
        ${name},
        ${email},
        ${interest},
        ${message},
        ${networkHash},
        ${userAgent}
      ) as submission_id
    `;

    const waitlistInterests = new Set(['creator', 'pro', 'team', 'enterprise']);
    if (waitlistInterests.has(interest)) {
      await sql`
        insert into app.waitlist (email, interest, source)
        values (${email}, ${interest}, 'contact-form')
        on conflict (email, interest)
        do update set updated_at = now()
      `;
    }

    return json({ ok: true, id: rows[0]?.submission_id }, 201);
  } catch (error) {
    const detail = error instanceof Error ? error.message : '';
    if (detail.includes('rate_limited')) {
      return json({ message: 'Please wait a few minutes before sending another message.' }, 429, { 'retry-after': '300' });
    }
    console.error('contact_submission_failed', { interest, error: detail.slice(0, 160) });
    return json({ message: 'We could not store your message. Please try again.' }, 500);
  }
};

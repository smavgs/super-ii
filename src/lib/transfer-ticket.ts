import { sha256Hex } from './scoped-auth';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const TOKEN_PREFIX = 'sii_xfer_';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[a-f0-9]{64}$/;

export type TransferTicket = {
  version: 1;
  transferId: string;
  repositoryId: string;
  revisionId: string;
  profileId: string;
  sizeBytes: number;
  sha256: string;
  expires: number;
};

function encode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function decode(value: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const base64 = value.replaceAll('-', '+').replaceAll('_', '/')
      + '='.repeat((4 - value.length % 4) % 4);
    const binary = atob(base64);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  if (secret.length < 32) throw new Error('transfer ticket secret is too short');
  const derived = await crypto.subtle.digest(
    'SHA-256',
    encoder.encode(`superii-transfer-ticket-v1\0${secret}`),
  );
  return crypto.subtle.importKey(
    'raw',
    derived,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

function ticketIsValid(ticket: unknown): ticket is TransferTicket {
  if (!ticket || typeof ticket !== 'object') return false;
  const value = ticket as Partial<TransferTicket>;
  return value.version === 1
    && typeof value.transferId === 'string' && UUID.test(value.transferId)
    && typeof value.repositoryId === 'string' && UUID.test(value.repositoryId)
    && typeof value.revisionId === 'string' && UUID.test(value.revisionId)
    && typeof value.profileId === 'string' && UUID.test(value.profileId)
    && Number.isSafeInteger(value.sizeBytes) && Number(value.sizeBytes) > 0
    && typeof value.sha256 === 'string' && SHA256.test(value.sha256)
    && Number.isSafeInteger(value.expires) && Number(value.expires) > Math.floor(Date.now() / 1000);
}

export async function signTransferTicket(secret: string, ticket: TransferTicket): Promise<string> {
  if (!ticketIsValid(ticket)) throw new Error('invalid transfer ticket payload');
  const payload = encode(encoder.encode(JSON.stringify(ticket)));
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(payload));
  return TOKEN_PREFIX + payload + '.' + encode(new Uint8Array(signature));
}

export async function verifyTransferTicket(
  secret: string,
  token: string,
): Promise<TransferTicket | null> {
  if (!token.startsWith(TOKEN_PREFIX) || token.length > 1500) return null;
  const segments = token.slice(TOKEN_PREFIX.length).split('.');
  if (segments.length !== 2) return null;
  const [payload, signature] = segments;
  const signatureBytes = decode(signature);
  const payloadBytes = decode(payload);
  if (!signatureBytes || signatureBytes.length !== 32 || !payloadBytes) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoder.decode(payloadBytes));
  } catch {
    return null;
  }
  if (!ticketIsValid(parsed)) return null;
  const valid = await crypto.subtle.verify(
    'HMAC',
    await hmacKey(secret),
    signatureBytes,
    encoder.encode(payload),
  );
  return valid ? parsed : null;
}

export async function transferCapabilityHash(token: string): Promise<string> {
  return sha256Hex(token);
}

export function transferTokenFrom(request: Request): string | null {
  const header = request.headers.get('x-superii-transfer-token')?.trim() ?? '';
  return header.startsWith(TOKEN_PREFIX) && header.length <= 1500 ? header : null;
}

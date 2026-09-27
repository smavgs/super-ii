import { runtimeValue } from './db';

type CipherEnvelope = {
  ciphertext: string;
  iv: string;
};

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error('invalid encrypted value');
  const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function encryptionKey(locals: App.Locals): Promise<CryptoKey> {
  const encoded = runtimeValue(locals, 'CARD_VAULT_ENCRYPTION_KEY');
  if (!encoded) throw new Error('card encryption unavailable');
  const bytes = fromBase64Url(encoded);
  if (bytes.byteLength !== 32) throw new Error('card encryption unavailable');
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptCardValue(
  locals: App.Locals,
  value: unknown,
  purpose: string,
): Promise<CipherEnvelope> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(purpose), tagLength: 128 },
    await encryptionKey(locals),
    encoder.encode(JSON.stringify(value)),
  );
  return { ciphertext: toBase64Url(new Uint8Array(encrypted)), iv: toBase64Url(iv) };
}

export async function decryptCardValue<T>(
  locals: App.Locals,
  envelope: CipherEnvelope,
  purpose: string,
): Promise<T> {
  const plaintext = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: fromBase64Url(envelope.iv),
      additionalData: encoder.encode(purpose),
      tagLength: 128,
    },
    await encryptionKey(locals),
    fromBase64Url(envelope.ciphertext),
  );
  return JSON.parse(decoder.decode(plaintext)) as T;
}

export function createCardToken(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function hashCardToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function validCardToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/u.test(token);
}

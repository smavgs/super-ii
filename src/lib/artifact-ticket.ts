const encoder = new TextEncoder();

function encoded(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function decoded(value: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) return null;
  try {
    const base64 = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4);
    const binary = atob(base64);
    const bytes = new Uint8Array(new ArrayBuffer(binary.length));
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return null;
  }
}

async function key(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

function message(userId: string, artifactId: string, expires: number): ArrayBuffer {
  return encoder.encode(`${userId}\n${artifactId}\n${expires}`).buffer as ArrayBuffer;
}

export async function signArtifactTicket(
  secret: string,
  userId: string,
  artifactId: string,
  expires: number,
): Promise<string> {
  const signature = await crypto.subtle.sign('HMAC', await key(secret), message(userId, artifactId, expires));
  return encoded(new Uint8Array(signature));
}

export async function verifyArtifactTicket(
  secret: string,
  userId: string,
  artifactId: string,
  expires: number,
  signature: string,
): Promise<boolean> {
  const bytes = decoded(signature);
  if (!bytes || expires <= Math.floor(Date.now() / 1000)) return false;
  return crypto.subtle.verify('HMAC', await key(secret), bytes.buffer, message(userId, artifactId, expires));
}

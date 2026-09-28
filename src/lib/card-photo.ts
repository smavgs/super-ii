export const cardPhotoMaximumBytes = 240_000;
export const cardPhotoMinimumDimension = 64;
export const cardPhotoMaximumDimension = 2_048;

const jpegStartOfFrameMarkers = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
  0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

export function cardPhotoBytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

export function cardPhotoBase64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error('invalid card photo data');
  const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export async function readBoundedCardPhoto(request: Request): Promise<Uint8Array<ArrayBuffer>> {
  if (request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'image/jpeg') {
    throw new Error('Choose a JPG, PNG, WebP or phone photo');
  }
  const declaredLength = Number(request.headers.get('content-length') ?? 0);
  if (declaredLength > cardPhotoMaximumBytes) throw new Error('The processed photo is too large');
  if (!request.body) throw new Error('Choose a photo first');

  const reader = request.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cardPhotoMaximumBytes) {
      await reader.cancel();
      throw new Error('The processed photo is too large');
    }
    chunks.push(new Uint8Array(value));
  }
  if (total < 512) throw new Error('The photo file is empty or invalid');
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export function stripJpegMetadata(input: Uint8Array): Uint8Array<ArrayBuffer> {
  if (input.length < 4 || input[0] !== 0xff || input[1] !== 0xd8) throw new Error('The photo is not a valid JPEG');
  const kept: Uint8Array[] = [input.slice(0, 2)];
  let offset = 2;
  while (offset < input.length) {
    if (input[offset] !== 0xff) throw new Error('The photo is not a valid JPEG');
    const markerStart = offset;
    while (offset < input.length && input[offset] === 0xff) offset += 1;
    if (offset >= input.length) throw new Error('The photo is not a valid JPEG');
    const marker = input[offset];
    offset += 1;
    if (marker === 0xd9) {
      kept.push(input.slice(markerStart, offset));
      break;
    }
    if (marker === 0xda) {
      kept.push(input.slice(markerStart));
      offset = input.length;
      break;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      kept.push(input.slice(markerStart, offset));
      continue;
    }
    if (offset + 2 > input.length) throw new Error('The photo is not a valid JPEG');
    const segmentLength = input[offset] * 256 + input[offset + 1];
    if (segmentLength < 2 || offset + segmentLength > input.length) throw new Error('The photo is not a valid JPEG');
    const segmentEnd = offset + segmentLength;
    const isMetadata = (marker >= 0xe0 && marker <= 0xef) || marker === 0xfe;
    if (!isMetadata) kept.push(input.slice(markerStart, segmentEnd));
    offset = segmentEnd;
  }
  if (offset !== input.length) throw new Error('The photo is not a valid JPEG');
  const total = kept.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const output = new Uint8Array(total);
  let outputOffset = 0;
  for (const chunk of kept) {
    output.set(chunk, outputOffset);
    outputOffset += chunk.byteLength;
  }
  return output;
}

export function jpegDimensions(bytes: Uint8Array): { width: number; height: number } {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('The photo is not a valid JPEG');
  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) throw new Error('The photo is not a valid JPEG');
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) throw new Error('The photo is not a valid JPEG');
    const segmentLength = bytes[offset] * 256 + bytes[offset + 1];
    if (segmentLength < 2 || offset + segmentLength > bytes.length) throw new Error('The photo is not a valid JPEG');
    if (jpegStartOfFrameMarkers.has(marker)) {
      if (segmentLength < 7) throw new Error('The photo is not a valid JPEG');
      const height = bytes[offset + 3] * 256 + bytes[offset + 4];
      const width = bytes[offset + 5] * 256 + bytes[offset + 6];
      if (
        width < cardPhotoMinimumDimension || height < cardPhotoMinimumDimension
        || width > cardPhotoMaximumDimension || height > cardPhotoMaximumDimension
      ) throw new Error(`Photo dimensions must be between ${cardPhotoMinimumDimension} and ${cardPhotoMaximumDimension} pixels`);
      return { width, height };
    }
    offset += segmentLength;
  }
  throw new Error('The photo dimensions could not be verified');
}

export async function cardPhotoSha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

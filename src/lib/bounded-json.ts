export type BoundedJsonResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; status: 400 | 413 | 415; error: string };

export async function readBoundedJsonObject(
  request: Request,
  maxBytes: number,
  allowEmpty = false,
  acceptedMediaTypes: readonly string[] = ['application/json'],
): Promise<BoundedJsonResult> {
  const declared = request.headers.get('content-length');
  if (allowEmpty && (request.body === null || declared === '0')) {
    return { ok: true, value: {} };
  }
  const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (!contentType || !acceptedMediaTypes.includes(contentType)) {
    return { ok: false, status: 415, error: 'expected JSON' };
  }
  if (declared !== null) {
    const length = Number(declared);
    if (!Number.isSafeInteger(length) || length < 0) {
      return { ok: false, status: 400, error: 'invalid Content-Length' };
    }
    if (length > maxBytes) return { ok: false, status: 413, error: 'JSON request is too large' };
  }

  const reader = request.body?.getReader();
  if (!reader) {
    return allowEmpty
      ? { ok: true, value: {} }
      : { ok: false, status: 400, error: 'invalid JSON' };
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return { ok: false, status: 413, error: 'JSON request is too large' };
    }
    chunks.push(value);
  }
  if (total === 0 && allowEmpty) return { ok: true, value: {} };

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, status: 400, error: 'JSON body must be an object' };
    }
    return { ok: true, value: parsed as Record<string, unknown> };
  } catch {
    return { ok: false, status: 400, error: 'invalid JSON' };
  }
}

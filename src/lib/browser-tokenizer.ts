type VerificationVector = {
  text: string;
  add_special_tokens: boolean;
  token_ids: number[];
};

export type TokenizerManifest = {
  pack_sha256: string;
  source_revision_id: string;
  engine: string;
  engine_version: string;
  tokenizer_class: string;
  vocabulary_size: number | null;
  context_length: number | null;
  browser_compatible: boolean;
  verification_vectors: VerificationVector[];
};

type BrowserTokenizer = Awaited<ReturnType<typeof import('@huggingface/transformers').AutoTokenizer.from_pretrained>>;

const cache = new Map<string, Promise<{ tokenizer: BrowserTokenizer; manifest: TokenizerManifest }>>();

class TokenizerRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'TokenizerRequestError';
  }
}

function safeIdentity(value: string): string {
  if (!/^[a-zA-Z0-9](?:[a-zA-Z0-9._-]{0,118}[a-zA-Z0-9])?$/.test(value)) {
    throw new Error('Tokenizer model identity is invalid.');
  }
  return value;
}

async function digest(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function tokenizerManifest(owner: string, slug: string): Promise<TokenizerManifest> {
  const response = await fetch(`/api/tokenizers/${encodeURIComponent(safeIdentity(owner))}/${encodeURIComponent(safeIdentity(slug))}/manifest`, {
    headers: { accept: 'application/json' },
  });
  const value = await response.json() as TokenizerManifest & { error?: string };
  if (!response.ok) throw new Error(value.error ?? 'Verified tokenizer is unavailable.');
  return value;
}

async function loadBrowserTokenizer(owner: string, slug: string, manifest: TokenizerManifest) {
  if (!manifest.browser_compatible) throw new Error('This tokenizer uses the verified server engine.');
  const key = `${owner}/${slug}@${manifest.pack_sha256}`;
  let loading = cache.get(key);
  if (!loading) {
    loading = (async () => {
      const transformers = await import('@huggingface/transformers');
      transformers.env.allowRemoteModels = false;
      transformers.env.allowLocalModels = true;
      transformers.env.localModelPath = '/api/tokenizers/';
      const tokenizer = await transformers.AutoTokenizer.from_pretrained(
        `${safeIdentity(owner)}/${safeIdentity(slug)}/revisions/${safeIdentity(manifest.source_revision_id)}/pack`,
        { local_files_only: true },
      );
      for (const vector of manifest.verification_vectors) {
        const ids = tokenizer.encode(vector.text, { add_special_tokens: vector.add_special_tokens });
        if (ids.length !== vector.token_ids.length || ids.some((id, index) => id !== vector.token_ids[index])) {
          throw new Error('Browser tokenizer did not match its verified reference vectors.');
        }
      }
      return { tokenizer, manifest };
    })();
    cache.set(key, loading);
  }
  try {
    return await loading;
  } catch (error) {
    cache.delete(key);
    throw error;
  }
}

export async function encodeInBrowser(
  owner: string,
  slug: string,
  manifest: TokenizerManifest,
  text: string,
  addSpecialTokens: boolean,
): Promise<Record<string, unknown>> {
  if (text.length > 100_000) throw new Error('Tokenizer input exceeds 100000 characters.');
  const { tokenizer } = await loadBrowserTokenizer(owner, slug, manifest);
  const encoding = tokenizer._tokenizer.encode(text, { add_special_tokens: addSpecialTokens });
  const specialIds = new Set(tokenizer.all_special_ids);
  const decoded = tokenizer.decode(encoding.ids, {
    skip_special_tokens: false,
    clean_up_tokenization_spaces: false,
  });
  return {
    tokens: encoding.tokens,
    token_ids: encoding.ids,
    pieces: encoding.ids.map((id, index) => ({
      id,
      token: encoding.tokens[index] ?? '',
      piece: tokenizer.decode([id], { skip_special_tokens: false, clean_up_tokenization_spaces: false }),
      special: specialIds.has(id),
      character_start: null,
      character_end: null,
      byte_start: null,
      byte_end: null,
    })),
    token_count: encoding.ids.length,
    decoded,
    decoded_sha256: await digest(decoded),
    add_special_tokens: addSpecialTokens,
    engine: 'huggingface-tokenizers-browser',
    tokenizer_class: manifest.tokenizer_class,
    context_length: manifest.context_length,
    pack_sha256: manifest.pack_sha256,
    pack_version: 'superii-tokenizer-pack-v1',
    revision_id: manifest.source_revision_id,
    verified: true,
    execution: 'browser',
    offset_scope: 'canonical offsets are returned by the server path',
  };
}

export async function decodeInBrowser(
  owner: string,
  slug: string,
  manifest: TokenizerManifest,
  tokenIds: number[],
  skipSpecialTokens: boolean,
): Promise<Record<string, unknown>> {
  if (tokenIds.length < 1 || tokenIds.length > 100_000
    || tokenIds.some((value) => !Number.isSafeInteger(value) || value < 0 || value > 2_147_483_647)) {
    throw new Error('Token IDs must contain 1 to 100000 non-negative 32-bit integers.');
  }
  const { tokenizer } = await loadBrowserTokenizer(owner, slug, manifest);
  const text = tokenizer.decode(tokenIds, {
    skip_special_tokens: skipSpecialTokens,
    clean_up_tokenization_spaces: false,
  });
  return {
    text,
    text_sha256: await digest(text),
    token_ids: tokenIds,
    token_count: tokenIds.length,
    skip_special_tokens: skipSpecialTokens,
    engine: 'huggingface-tokenizers-browser',
    tokenizer_class: manifest.tokenizer_class,
    pack_sha256: manifest.pack_sha256,
    pack_version: 'superii-tokenizer-pack-v1',
    revision_id: manifest.source_revision_id,
    verified: true,
    execution: 'browser',
  };
}

async function request(
  owner: string,
  slug: string,
  operation: 'encode' | 'decode',
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await fetch(`/api/tokenizers/${encodeURIComponent(owner)}/${encodeURIComponent(slug)}/${operation}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const value = await response.json() as Record<string, unknown> & { error?: string };
  if (!response.ok) throw new TokenizerRequestError(value.error ?? 'Verified tokenizer request failed.', response.status);
  return { ...value, execution: 'server' };
}

export async function encodeVerified(owner: string, slug: string, text: string, addSpecialTokens: boolean) {
  const manifest = await tokenizerManifest(owner, slug);
  try {
    // The canonical runtime returns verified character and byte offsets. The
    // portable browser pack is a resilience path when that runtime is down.
    return await request(owner, slug, 'encode', { text, add_special_tokens: addSpecialTokens });
  } catch (error) {
    if (!manifest.browser_compatible || (error instanceof TokenizerRequestError && error.status !== 503)) throw error;
    return encodeInBrowser(owner, slug, manifest, text, addSpecialTokens);
  }
}

export async function decodeVerified(owner: string, slug: string, tokenIds: number[], skipSpecialTokens: boolean) {
  const manifest = await tokenizerManifest(owner, slug);
  try {
    return await request(owner, slug, 'decode', { token_ids: tokenIds, skip_special_tokens: skipSpecialTokens });
  } catch (error) {
    if (!manifest.browser_compatible || (error instanceof TokenizerRequestError && error.status !== 503)) throw error;
    return decodeInBrowser(owner, slug, manifest, tokenIds, skipSpecialTokens);
  }
}

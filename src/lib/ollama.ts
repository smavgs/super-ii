import type { NeonQueryFunction } from "@neondatabase/serverless";
import type { LinkedWorkItem } from "./linked-work";

export const OLLAMA_REGISTRY = "https://registry.ollama.ai";
export const validOllamaSlug = (value: string) =>
  /^[a-z0-9][a-z0-9._-]{0,99}$/.test(value);
export const validOllamaTag = (value: string) =>
  /^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$/.test(value);
const validDigest = (value: unknown): value is string =>
  typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
export type OllamaLayer = { mediaType: string; digest: string; size: number };
export type OllamaManifest = {
  schemaVersion: 2;
  config: OllamaLayer;
  layers: OllamaLayer[];
  format?: string;
};
export type OllamaListing = LinkedWorkItem & {
  card_markdown: string;
  owner_profile_id: string | null;
  owner_organization_id: string | null;
};
export type OllamaFile = OllamaLayer & {
  filename: string;
  label: string;
  weight: boolean;
};

export function parseOllamaManifest(value: unknown): OllamaManifest {
  const manifest = value as OllamaManifest;
  const layerValid = (layer: OllamaLayer) =>
    layer &&
    validDigest(layer.digest) &&
    Number.isSafeInteger(layer.size) &&
    layer.size >= 0 &&
    layer.size <= 2 * 1024 ** 4 &&
    typeof layer.mediaType === "string" &&
    layer.mediaType.length < 150;
  if (
    !manifest ||
    manifest.schemaVersion !== 2 ||
    !layerValid(manifest.config) ||
    manifest.config.size > 128000 ||
    !Array.isArray(manifest.layers) ||
    manifest.layers.length > 256 ||
    !manifest.layers.every(layerValid)
  ) {
    throw new Error("Ollama returned an unsupported manifest.");
  }
  return manifest;
}

export function ollamaFiles(
  slug: string,
  tag: string,
  manifest: OllamaManifest,
  format = "",
): OllamaFile[] {
  if (!validOllamaSlug(slug) || !validOllamaTag(tag)) return [];
  const known: Record<string, [string, string, boolean]> = {
    model: [
      "Model weights",
      format === "gguf"
        ? "gguf"
        : format === "safetensors"
          ? "safetensors"
          : "bin",
      true,
    ],
    projector: ["Vision projector", "gguf", true],
    adapter: ["Adapter", "bin", true],
    template: ["Chat template", "txt", false],
    system: ["System prompt", "txt", false],
    params: ["Parameters", "json", false],
    license: ["License", "txt", false],
  };
  return manifest.layers.flatMap((layer, index) => {
    const type = layer.mediaType.replace("application/vnd.ollama.image.", "");
    const spec = known[type];
    if (!spec) return [];
    const count = manifest.layers.filter(
      (other) => other.mediaType === layer.mediaType,
    ).length;
    const suffix = count > 1 ? `-${index + 1}` : "";
    return [
      {
        ...layer,
        filename: `${slug}-${tag}-${type}${suffix}.${spec[1]}`,
        label: spec[0],
        weight: spec[2],
      },
    ];
  });
}

export async function boundedRemoteJson(
  response: Response,
  maximum = 128000,
): Promise<unknown> {
  if (!response.ok || !response.body)
    throw new Error("Ollama could not provide this version.");
  const reader = response.body.getReader();
  let total = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximum) throw new Error("Ollama metadata is too large.");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const combined = new Uint8Array(total);
  let position = 0;
  for (const chunk of chunks) {
    combined.set(chunk, position);
    position += chunk.length;
  }
  return JSON.parse(new TextDecoder().decode(combined));
}

export async function fetchOllamaMetadata(
  url: string,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  for (let redirects = 0; ; redirects++) {
    const parsed = new URL(url);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.port ||
      !(
        parsed.hostname === "registry.ollama.ai" ||
        /^[a-f0-9]{32}\.r2\.cloudflarestorage\.com$/.test(parsed.hostname)
      )
    )
      throw new Error("Unsupported metadata destination.");
    const response = await fetcher(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(15000),
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    await response.body?.cancel();
    if (redirects >= 3 || !response.headers.get("location"))
      throw new Error("Ollama metadata redirect failed.");
    url = new URL(response.headers.get("location")!, url).href;
  }
}

export async function resolveOllamaVersion(
  slug: string,
  tag: string,
  fetcher: typeof fetch = fetch,
) {
  if (!validOllamaSlug(slug) || !validOllamaTag(tag))
    throw new Error("Invalid Ollama model or version.");
  const manifest = parseOllamaManifest(
    await boundedRemoteJson(
      await fetcher(`${OLLAMA_REGISTRY}/v2/library/${slug}/manifests/${tag}`, {
        redirect: "manual",
        signal: AbortSignal.timeout(15000),
        headers: {
          accept: "application/vnd.docker.distribution.manifest.v2+json",
        },
      }),
    ),
  );
  let format = manifest.format ?? "";
  if (!format) {
    try {
      const config = (await boundedRemoteJson(
        await fetchOllamaMetadata(
          `${OLLAMA_REGISTRY}/v2/library/${slug}/blobs/${manifest.config.digest}`,
          fetcher,
        ),
        128000,
      )) as Record<string, unknown>;
      format =
        typeof config.model_format === "string" ? config.model_format : "";
    } catch {
      /* Unknown formats stay .bin; never guess GGUF. */
    }
  }
  return { manifest, format, files: ollamaFiles(slug, tag, manifest, format) };
}

export async function getOllamaListing(
  sql: NeonQueryFunction<false, false>,
  lookup: { id: string } | { owner: string; slug: string },
): Promise<OllamaListing | null> {
  const rows = await sql.query(
    `select item.*,coalesce(profile.handle,organization.handle) as owner_handle,
    coalesce(profile.display_name,organization.full_name,organization.name) as owner_display_name,
    coalesce(profile.avatar_url,organization.logo_url) as owner_avatar_url,
    case when item.owner_profile_id is not null then 'person' else 'organization' end as owner_type
    from app.external_catalog_items item
    left join app.profiles profile on profile.id=item.owner_profile_id and profile.is_public
    left join app.organizations organization on organization.id=item.owner_organization_id and organization.is_public
    where item.provider='ollama' and item.status='active' and (profile.id is not null or organization.id is not null)
      and (($1::uuid is not null and item.id=$1::uuid) or ($1::uuid is null
        and lower(coalesce(profile.handle,organization.handle))=$2 and item.provider_slug=$3)) limit 1`,
    "id" in lookup
      ? [lookup.id, "", ""]
      : [null, lookup.owner.toLowerCase(), lookup.slug],
  );
  return (rows[0] as OllamaListing | undefined) ?? null;
}

export const ollamaPagePath = (item: {
  owner_handle: string;
  provider_slug: string;
}) =>
  `/models/${encodeURIComponent(item.owner_handle)}/ollama-${encodeURIComponent(item.provider_slug)}`;
export const ollamaDownloadPath = (id: string, tag: string, file: OllamaFile) =>
  `/api/ollama/${id}/download?tag=${encodeURIComponent(tag)}&file=${file.digest}`;
export function ollamaFileSize(bytes: number) {
  return bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(2)} GiB`
    : bytes >= 1024 ** 2
      ? `${(bytes / 1024 ** 2).toFixed(1)} MiB`
      : bytes >= 1024
        ? `${(bytes / 1024).toFixed(1)} KiB`
        : `${bytes} B`;
}

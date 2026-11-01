import type { APIRoute } from "astro";
import { sqlClient } from "@/lib/db";
import { consumeRateLimit } from "@/lib/rate-limit";
import {
  getOllamaListing,
  resolveOllamaVersion,
  validOllamaTag,
  parseOllamaManifest,
  ollamaFiles,
} from "@/lib/ollama";
import { streamOllamaFile } from "@/lib/ollama-download";

const serve: APIRoute = async ({ params, request, locals, url }) => {
  const error = (message: string, status: number) =>
    Response.json(
      { error: message },
      { status, headers: { "cache-control": "private, no-store" } },
    );
  const tag = url.searchParams.get("tag") ?? "latest";
  const digest = url.searchParams.get("file") ?? "";
  if (
    !/^[a-f0-9-]{36}$/.test(params.id ?? "") ||
    !validOllamaTag(tag) ||
    !/^sha256:[a-f0-9]{64}$/.test(digest)
  )
    return error("Invalid model file.", 400);
  const sql = sqlClient(locals);
  if (!sql) return error("Downloads are temporarily unavailable.", 503);
  try {
    const item = await getOllamaListing(sql, { id: params.id! });
    if (!item) return error("This public model listing is unavailable.", 404);
    const rate = await consumeRateLimit(
      locals,
      request,
      sql,
      "ollama.download",
      120,
      3600,
    );
    if (rate !== "allowed")
      return error(
        rate === "limited"
          ? "Please wait before starting more downloads."
          : "Downloads are temporarily unavailable.",
        rate === "limited" ? 429 : 503,
      );
    // A displayed source snapshot already binds this immutable digest. Keep its
    // download/resume link stable when Ollama moves the mutable latest tag.
    let file;
    if (tag === "latest" && item.source_metadata.manifest) {
      const snapshot = parseOllamaManifest(item.source_metadata.manifest);
      const format =
        typeof item.source_metadata.format === "string"
          ? item.source_metadata.format
          : "";
      file = ollamaFiles(item.provider_slug, tag, snapshot, format).find(
        (candidate) => candidate.digest === digest,
      );
    }
    if (!file) {
      const version = await resolveOllamaVersion(item.provider_slug, tag);
      file = version.files.find((candidate) => candidate.digest === digest);
    }
    if (!file)
      return error(
        "This version has changed. Load the version again in Files & versions before downloading.",
        409,
      );
    return await streamOllamaFile(request, item.provider_slug, file);
  } catch {
    return error(
      "Ollama could not deliver this file. Please try again shortly.",
      502,
    );
  }
};
export const GET = serve;
export const HEAD = serve;

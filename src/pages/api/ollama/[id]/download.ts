import type { APIRoute } from "astro";
import { sqlClient } from "@/lib/db";
import { consumeRateLimit } from "@/lib/rate-limit";
import {
  getOllamaListing,
  resolveOllamaVersion,
  validOllamaTag,
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
    const version = await resolveOllamaVersion(item.provider_slug, tag);
    const file = version.files.find((file) => file.digest === digest);
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

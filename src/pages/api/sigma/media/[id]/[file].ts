import type { APIRoute } from "astro";
import { z } from "zod";
import { sqlClient } from "@/lib/db";
import { showcaseBucket } from "@/lib/showcase-media";
export const GET: APIRoute = async ({ locals, params }) => {
  const headers = {
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
  };
  if (
    !z.uuid().safeParse(params.id).success ||
    !/^[a-f0-9]{64}\.jpg$/.test(params.file ?? "")
  )
    return new Response(null, { status: 404, headers });
  try {
    const sql = sqlClient(locals);
    const bucket = showcaseBucket();
    if (!sql || !bucket) return new Response(null, { status: 503, headers });
    const url = `/api/sigma/media/${params.id}/${params.file}`;
    const rows =
      await sql`select app.sigma_media_access(${params.id}::uuid,${url},false) as allowed`;
    if (!rows[0].allowed) return new Response(null, { status: 404, headers });
    const image = await bucket.get(`sigma/${params.id}/${params.file}`);
    return image
      ? new Response(image.body, {
          headers: {
            ...headers,
            "content-type": "image/jpeg",
            "content-length": String(image.size),
          },
        })
      : new Response(null, { status: 404, headers });
  } catch {
    return new Response(null, { status: 503, headers });
  }
};

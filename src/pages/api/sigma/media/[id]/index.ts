import type { APIRoute } from "astro";
import { z } from "zod";
import { showcaseBucket, readBoundedShowcasePhoto } from "@/lib/showcase-media";
import {
  stripJpegMetadata,
  jpegDimensions,
  cardPhotoSha256,
} from "@/lib/card-photo";
import { sigmaJson, sigmaWriter } from "@/lib/sigma-http";
import { consumeIdentityRateLimit } from "@/lib/rate-limit";
export const POST: APIRoute = async ({ locals, request, params }) => {
  try {
    if (!z.uuid().safeParse(params.id).success)
      return sigmaJson({ error: "invalid" }, 400);
    const auth = await sigmaWriter(locals, request, 120);
    if (auth.error) return auth.error;
    const allowed =
      await auth.sql`select app.sigma_media_access(${params.id}::uuid,'',true) as allowed`;
    if (!allowed[0].allowed) return sigmaJson({ error: "not_allowed" }, 403);
    const rate = await consumeIdentityRateLimit(
      locals,
      auth.sql,
      auth.profile.profileId,
      "sigma.image",
      60,
      86400,
    );
    if (rate !== "allowed")
      return sigmaJson(
        { error: rate === "limited" ? "limited" : "unavailable" },
        rate === "limited" ? 429 : 503,
      );
    const bucket = showcaseBucket();
    if (!bucket) return sigmaJson({ error: "unavailable" }, 503);
    const bytes = stripJpegMetadata(await readBoundedShowcasePhoto(request));
    const { width, height } = jpegDimensions(bytes);
    if (width < 64 || height < 64 || width > 2400 || height > 2400)
      return sigmaJson({ error: "invalid_dimensions" }, 400);
    const hash = await cardPhotoSha256(bytes);
    await bucket.put(`sigma/${params.id}/${hash}.jpg`, bytes, {
      httpMetadata: { contentType: "image/jpeg" },
    });
    return sigmaJson({ url: `/api/sigma/media/${params.id}/${hash}.jpg` }, 201);
  } catch {
    return sigmaJson({ error: "upload_failed" }, 400);
  }
};

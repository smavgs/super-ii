import type { APIRoute } from "astro";
import {
  authorizeProductEditor,
  productError,
  productPrivateHeaders as headers,
} from "@/lib/product-http";
import { decryptCardValue } from "@/lib/card-crypto";
export const GET: APIRoute = async ({ locals, request }) => {
  const auth = await authorizeProductEditor(locals, request);
  if (!auth.ok) return auth.response;
  try {
    const rows =
      await auth.sql`select c.name,c.share_token_ciphertext,c.share_token_iv from app.cards c
      join app.card_public_snapshots s on s.card_id=c.id where c.owner_profile_id=${auth.profile.profileId}::uuid and c.status='active' limit 6`;
    const items = await Promise.all(
      rows.map(async (row) => ({
        name: row.name,
        url: `https://superii.site/c/${await decryptCardValue<string>(
          locals,
          {
            ciphertext: String(row.share_token_ciphertext),
            iv: String(row.share_token_iv),
          },
          `card-token:${auth.profile.profileId}`,
        )}`,
      })),
    );
    return Response.json({ items }, { headers });
  } catch (error) {
    return productError(error);
  }
};

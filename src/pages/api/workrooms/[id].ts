import type { APIRoute } from "astro";
import { z } from "zod";
import { readBoundedJsonObject } from "@/lib/bounded-json";
import { roomUpdate, entryCreation } from "@/lib/workrooms";
import {
  workroomMember,
  workroomJson,
  workroomError,
} from "@/lib/workroom-http";
const share = z
  .object({
    handle: z.string().trim().min(1).max(100),
    role: z.enum(["viewer", "editor", "remove"]),
  })
  .strict();
export const GET: APIRoute = async ({ locals, request, params }) => {
  if (!z.uuid().safeParse(params.id).success)
    return workroomJson({ error: "Workroom not found" }, 404);
  try {
    const auth = await workroomMember(locals, request);
    if (!auth.ok) return auth.response;
    const rows =
      await auth.sql`select app.read_workroom(${params.id}::uuid) as room`;
    return rows[0]?.room
      ? workroomJson(rows[0].room)
      : workroomJson({ error: "Workroom not found" }, 404);
  } catch (e) {
    return workroomError(e);
  }
};
export const POST: APIRoute = async ({ locals, request, params, url }) => {
  if (!z.uuid().safeParse(params.id).success)
    return workroomJson({ error: "Workroom not found" }, 404);
  try {
    const auth = await workroomMember(locals, request);
    if (!auth.ok) return auth.response;
    const body = await readBoundedJsonObject(request, 40000);
    if (!body.ok) return workroomJson({ error: body.error }, body.status);
    const action = url.searchParams.get("action");
    let rows;
    if (action === "entry") {
      const parsed = entryCreation.safeParse(body.value);
      if (!parsed.success)
        return workroomJson({ error: parsed.error.issues[0].message }, 422);
      rows =
        await auth.sql`select app.add_workroom_entry(${params.id}::uuid,${parsed.data.creation_key}::uuid,${JSON.stringify(parsed.data.document)}::jsonb) as room`;
    } else if (action === "share") {
      const parsed = share.safeParse(body.value);
      if (!parsed.success)
        return workroomJson(
          { error: "Review the member handle and access." },
          422,
        );
      rows =
        await auth.sql`select app.share_workroom(${params.id}::uuid,${parsed.data.handle},${parsed.data.role}) as room`;
    } else if (action === "save") {
      const parsed = roomUpdate.safeParse(body.value);
      if (!parsed.success)
        return workroomJson({ error: parsed.error.issues[0].message }, 422);
      const v = parsed.data;
      rows =
        await auth.sql`select app.save_workroom(${params.id}::uuid,${v.version},${JSON.stringify(v.document)}::jsonb,${v.status},${v.reviewed_entry_id}::uuid) as room`;
    } else return workroomJson({ error: "Unknown workroom action" }, 422);
    return workroomJson(rows[0].room);
  } catch (e) {
    return workroomError(e);
  }
};

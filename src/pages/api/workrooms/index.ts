import type { APIRoute } from "astro";
import { readBoundedJsonObject } from "@/lib/bounded-json";
import { roomCreation } from "@/lib/workrooms";
import {
  workroomMember,
  workroomJson,
  workroomError,
} from "@/lib/workroom-http";
export const GET: APIRoute = async ({ locals, request }) => {
  try {
    const auth = await workroomMember(locals, request);
    if (!auth.ok) return auth.response;
    const rows = await auth.sql`select app.workroom_workspace() as workspace`;
    return workroomJson(rows[0].workspace);
  } catch (e) {
    return workroomError(e);
  }
};
export const POST: APIRoute = async ({ locals, request }) => {
  try {
    const auth = await workroomMember(locals, request);
    if (!auth.ok) return auth.response;
    const body = await readBoundedJsonObject(request, 40000);
    if (!body.ok) return workroomJson({ error: body.error }, body.status);
    const input = roomCreation.safeParse(body.value);
    if (!input.success)
      return workroomJson({ error: input.error.issues[0].message }, 422);
    const v = input.data;
    const rows =
      await auth.sql`select app.create_workroom(${v.creation_key}::uuid,${v.organization_id}::uuid,${v.repository_id}::uuid,${JSON.stringify(v.document)}::jsonb) as id`;
    return workroomJson({ id: rows[0].id }, 201);
  } catch (e) {
    return workroomError(e);
  }
};

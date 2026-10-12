import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { agentBearerToken } from "./agent-auth";
import { sha256Hex } from "./scoped-auth";
import { sqlClient } from "./db";
import { entryDocument } from "./workrooms";
export function registerWorkroomTools(
  server: McpServer,
  locals: App.Locals,
  request: Request,
) {
  const run = async (input: {
    repository_id: string;
    workroom_id?: string;
    before?: string;
    creation_key?: string;
    document?: z.infer<typeof entryDocument>;
  }) => {
    try {
      const token = agentBearerToken(request),
        sql = sqlClient(locals);
      if (!token || !sql)
        throw new Error("A scoped agent connection is required.");
      const hash = await sha256Hex(token);
      const rows = input.document
        ? await sql`select app.agent_report_workroom(${hash},${input.repository_id}::uuid,${input.workroom_id}::uuid,${input.creation_key}::uuid,${JSON.stringify(input.document)}::jsonb) as result`
        : await sql`select app.agent_read_workroom(${hash},${input.repository_id}::uuid,${input.workroom_id ?? null}::uuid,${input.before ?? null}::uuid) as result`;
      let result = rows[0].result;
      if (result && !Array.isArray(result) && Array.isArray(result.entries))
        result = {
          ...result,
          entry_count: result.entries.length,
          entries: result.entries.slice(-20),
        };
      const text = JSON.stringify(result);
      if (text.length > 240000)
        throw new Error("Response too large; open the workroom in Workspace.");
      return { content: [{ type: "text" as const, text }] };
    } catch {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              error:
                "Workroom action refused or unavailable. Check connection scopes, repository binding, expiry, remaining actions and the workroom state. Reuse the same creation_key only for an exact retry; do not report this action as complete.",
            }),
          },
        ],
      };
    }
  };
  server.registerTool(
    "get_workroom",
    {
      title: "Read a repository workroom",
      description:
        "List up to 50 authorized organization workroom summaries for an exact repository (pass next_before as before for more), or read one goal, source and up to 20 recent reported entries. Requires explicit workroom:read. Private personal workrooms are not exposed.",
      inputSchema: z
        .object({
          repository_id: z.uuid(),
          workroom_id: z.uuid().optional(),
          before: z.uuid().optional(),
        })
        .strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    run,
  );
  server.registerTool(
    "report_workroom_result",
    {
      title: "Report workroom progress",
      description:
        "Append a note, blocker or reported result to a repository-bound organization workroom. Requires explicit workroom:report. Results wait for member review; cannot complete, publish, invite, execute code or change goals. Reuse creation_key for an exact retry.",
      inputSchema: z
        .object({
          repository_id: z.uuid(),
          workroom_id: z.uuid(),
          creation_key: z.uuid(),
          document: entryDocument,
        })
        .strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    run,
  );
}

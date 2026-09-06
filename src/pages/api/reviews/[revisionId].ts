import type { APIRoute } from 'astro';

// Historical review rows remain available in the workspace. Human approvals
// cannot bypass the independent publication policy.
export const POST: APIRoute = async () => Response.json({
  error: 'Manual publication approval has been retired. Resubmit the revision for automatic policy evaluation.',
}, { status: 410 });

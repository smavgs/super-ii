import type { NeonQueryFunction } from '@neondatabase/serverless';
import type { APIRoute } from 'astro';
import { ensureAuthenticatedProfile, sameOrigin, type AuthenticatedProfile } from '@/lib/auth';
import { runtimeValue, sqlClient } from '@/lib/db';
import {
  OPENROUTER_CHAT_ENDPOINT,
  OPENROUTER_MODEL,
  openRouterAnswer,
  openRouterChatRequest,
  openRouterToolCall,
  openRouterToolFollowupRequest,
  parseAssistantMessages,
  parseAssistantSkillContext,
  parseRuntimeSearchResults,
} from '@/lib/openrouter';
import { consumeIdentityRateLimit, consumeRateLimit } from '@/lib/rate-limit';
import { runtimeFetch } from '@/lib/runtime';

const MAX_REQUEST_CHARS = 24_000;
const SEARCH_WINDOW_SECONDS = 86_400;
const SEARCH_LIMITS = {
  free: 3,
  pro: 30,
  team: 60,
  enterprise: 60,
} as const;
type SearchPlan = keyof typeof SEARCH_LIMITS;

function json(body: Record<string, unknown>, status: number, extraHeaders: HeadersInit = {}) {
  return Response.json(body, {
    status,
    headers: {
      'cache-control': 'no-store, private',
      pragma: 'no-cache',
      vary: 'Cookie',
      ...extraHeaders,
    },
  });
}

function retryAfter(upstream: Response): string {
  const value = upstream.headers.get('retry-after');
  return value && /^\d{1,6}$/.test(value) ? value : '60';
}

async function activeSearchPlan(
  sql: NeonQueryFunction<false, false>,
  profile: AuthenticatedProfile,
): Promise<SearchPlan> {
  const rows = await sql`
    select s.plan_id
    from app.subscriptions s
    where s.status = 'active'
      and (s.current_period_end is null or s.current_period_end > now())
      and s.plan_id in ('pro', 'team', 'enterprise')
      and (
        s.clerk_user_id = ${profile.clerkUserId}
        or exists (
          select 1
          from app.organization_members member
          join app.organizations organization on organization.id = member.organization_id
          where member.profile_id = ${profile.profileId}::uuid
            and (
              s.organization_id = organization.id
              or (
                s.clerk_organization_id is not null
                and s.clerk_organization_id = organization.clerk_organization_id
              )
            )
        )
      )
    order by case s.plan_id when 'enterprise' then 3 when 'team' then 2 else 1 end desc
    limit 1
  `;
  const plan = rows[0]?.plan_id;
  return plan === 'enterprise' || plan === 'team' || plan === 'pro' ? plan : 'free';
}

async function callOpenRouter(apiKey: string, body: object): Promise<{
  response: Response;
  payload: unknown;
} | null> {
  try {
    const response = await fetch(OPENROUTER_CHAT_ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
        'HTTP-Referer': 'https://www.superii.site',
        'X-OpenRouter-Title': 'Super ii',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45_000),
    });
    return { response, payload: await response.json().catch(() => null) };
  } catch (error) {
    console.error(JSON.stringify({
      message: 'assistant provider request failed',
      reason: error instanceof Error ? error.name : 'unknown',
    }));
    return null;
  }
}

function providerFailure(result: Awaited<ReturnType<typeof callOpenRouter>>) {
  if (!result) return json({ error: 'assistant connection unavailable' }, 503, { 'retry-after': '30' });
  console.error(JSON.stringify({
    message: 'assistant provider rejected request',
    status: result.response.status,
  }));
  return json(
    { error: result.response.status === 429 ? 'assistant is busy' : 'assistant connection unavailable' },
    result.response.status === 429 ? 429 : 503,
    result.response.status === 429 ? { 'retry-after': retryAfter(result.response) } : {},
  );
}

export const POST: APIRoute = async ({ locals, request }) => {
  if (!sameOrigin(request)) return json({ error: 'invalid origin' }, 403);

  const sql = sqlClient(locals);
  if (!sql) return json({ error: 'assistant safety service unavailable' }, 503);

  let profile: AuthenticatedProfile;
  try {
    const authenticated = await ensureAuthenticatedProfile(locals, sql);
    if (!authenticated) return json({ error: 'authentication required' }, 401);
    profile = authenticated;
  } catch {
    return json({ error: 'authentication service unavailable' }, 503);
  }

  const rawBody = await request.text().catch(() => '');
  if (!rawBody || rawBody.length > MAX_REQUEST_CHARS) {
    return json({ error: rawBody ? 'assistant request too large' : 'invalid assistant request' }, rawBody ? 413 : 400);
  }

  let input: unknown;
  try {
    input = JSON.parse(rawBody) as unknown;
  } catch {
    return json({ error: 'invalid assistant request' }, 400);
  }
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return json({ error: 'invalid assistant request' }, 400);
  }
  const body = input as Record<string, unknown>;
  if ('web_search' in body && typeof body.web_search !== 'boolean') {
    return json({ error: 'invalid assistant search setting' }, 400);
  }
  const messages = parseAssistantMessages(body.messages);
  if (!messages) return json({ error: 'invalid assistant conversation' }, 400);
  let skillContext;
  if ('skill_context' in body) {
    const parsedSkillContext = parseAssistantSkillContext(body.skill_context);
    if (!parsedSkillContext) return json({ error: 'invalid skill setup context' }, 400);
    skillContext = parsedSkillContext;
  }
  const webSearchEnabled = body.web_search === true;

  const rate = await consumeRateLimit(locals, request, sql, 'assistant.chat', 30, 3600);
  if (rate !== 'allowed') {
    return json(
      { error: rate === 'limited' ? 'assistant message limit reached' : 'assistant safety service unavailable' },
      rate === 'limited' ? 429 : 503,
      rate === 'limited' ? { 'retry-after': '3600' } : {},
    );
  }

  const apiKey = runtimeValue(locals, 'OPENROUTER_API_KEY');
  if (!apiKey) return json({ error: 'assistant is not configured' }, 503);

  const initial = await callOpenRouter(apiKey, openRouterChatRequest(messages, webSearchEnabled, skillContext));
  if (!initial?.response.ok) return providerFailure(initial);

  const toolCall = webSearchEnabled ? openRouterToolCall(initial.payload) : null;
  if (!toolCall) {
    const answer = openRouterAnswer(initial.payload);
    if (!answer) {
      console.error(JSON.stringify({ message: 'assistant provider returned no answer' }));
      return json({ error: 'assistant connection unavailable' }, 503, { 'retry-after': '30' });
    }
    return json({
      answer,
      model: OPENROUTER_MODEL,
      sources: [],
      search: { enabled: webSearchEnabled, performed: false },
    }, 200);
  }

  let plan: SearchPlan;
  try {
    plan = await activeSearchPlan(sql, profile);
  } catch {
    return json({ error: 'assistant safety service unavailable' }, 503);
  }
  const allowance = SEARCH_LIMITS[plan];
  const searchRate = await consumeIdentityRateLimit(
    locals,
    sql,
    profile.profileId,
    'assistant.web_search',
    allowance,
    SEARCH_WINDOW_SECONDS,
  );
  if (searchRate !== 'allowed') {
    if (searchRate === 'unavailable') return json({ error: 'assistant safety service unavailable' }, 503);
    return json({
      error: 'daily web search limit reached',
      code: 'search_limit_reached',
      plan,
      limit: allowance,
    }, 429, { 'retry-after': String(SEARCH_WINDOW_SECONDS) });
  }

  let runtimeResponse: Response | null;
  try {
    runtimeResponse = await runtimeFetch(locals, '/v1/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        query: toolCall.query,
        category: toolCall.category,
        freshness: toolCall.freshness,
        safe_search: 'moderate',
        max_results: toolCall.maxResults,
      }),
      signal: AbortSignal.timeout(12_000),
    });
  } catch (error) {
    console.error(JSON.stringify({
      message: 'assistant web search request failed',
      reason: error instanceof Error ? error.name : 'unknown',
    }));
    runtimeResponse = null;
  }
  if (!runtimeResponse?.ok) {
    console.error(JSON.stringify({
      message: 'assistant web search unavailable',
      status: runtimeResponse?.status ?? null,
    }));
    return json({ error: 'web search is temporarily unavailable' }, 503, { 'retry-after': '30' });
  }
  const sources = parseRuntimeSearchResults(await runtimeResponse.json().catch(() => null));
  if (!sources) return json({ error: 'web search is temporarily unavailable' }, 503, { 'retry-after': '30' });

  const final = await callOpenRouter(apiKey, openRouterToolFollowupRequest(messages, toolCall, sources, skillContext));
  if (!final?.response.ok) return providerFailure(final);
  const answer = openRouterAnswer(final.payload);
  if (!answer) return json({ error: 'assistant connection unavailable' }, 503, { 'retry-after': '30' });

  return json({
    answer,
    model: OPENROUTER_MODEL,
    sources,
    search: { enabled: true, performed: true, plan, limit: allowance },
  }, 200);
};

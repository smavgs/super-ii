import type { APIRoute } from 'astro';
import { sameOrigin } from '@/lib/auth';
import { sqlClient, setSqlActorContext } from '@/lib/db';
import { readBoundedJsonObject } from '@/lib/bounded-json';

const headers = { 'cache-control':'private, no-store', vary:'Cookie' };
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
async function session(locals: App.Locals) {
  const authentication = typeof locals.auth === 'function' ? locals.auth() : null;
  const userId = authentication && 'userId' in authentication ? authentication.userId : null;
  if (!userId) return null;
  const sql = sqlClient(locals);
  if (!sql) throw new Error('database unavailable');
  // Polling is read-only: no Clerk profile rewrite or external user lookup.
  const rows = await sql`select id from app.profiles where clerk_user_id=${userId} limit 1`;
  const profileId = rows[0]?.id as string | undefined;
  if (!profileId) return {sql,profileId:null};
  setSqlActorContext(sql,{actorKind:'clerk',clerkUserId:userId,profileId});
  return {sql,profileId};
}
export const GET: APIRoute = async ({locals,url}) => {
  const filter = url.searchParams.get('filter') ?? 'unread';
  const before = url.searchParams.get('before'), beforeId = url.searchParams.get('before_id');
  if (!['unread','action','all'].includes(filter) || Boolean(before)!==Boolean(beforeId)
    || before && (!/^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:?\d{2})$/.test(before) || !Number.isFinite(Date.parse(before)) || !uuid.test(beforeId!)))
    return Response.json({error:'Invalid notification query.'},{status:400,headers});
  try {
    const actor = await session(locals);
    if (!actor) return Response.json({error:'Sign in to see notifications.'},{status:401,headers});
    if (!actor.profileId) return Response.json({unread:0,needs_action:0,latest:null,items:[],next:null},{headers});
    const {sql,profileId} = actor;
    const summary = url.searchParams.get('summary') === '1';
    const rows = await sql`
      with visible as materialized (select * from app.notifications where profile_id=${profileId}::uuid),
      page as (select id,event_type,title,body,href,read_at,created_at,needs_action from visible
        where not ${summary} and (${filter}='all' or (${filter}='unread' and read_at is null) or (${filter}='action' and needs_action))
          and (${before}::timestamptz is null or (created_at,id)<(${before}::timestamptz,${beforeId}::uuid))
        order by created_at desc,id desc limit 31)
      select (select count(*)::integer from visible where read_at is null) as unread,
        (select count(*)::integer from visible where needs_action) as needs_action,
        (select id from visible order by created_at desc,id desc limit 1) as latest,
        coalesce((select jsonb_agg(page order by created_at desc,id desc) from page),'[]'::jsonb) as items
    `;
    const result = rows[0] as {unread:number;needs_action:number;latest:string|null;items:Array<{id:string;created_at:string}>};
    const hasMore = result.items.length > 30;
    result.items = result.items.slice(0,30);
    const last = result.items.at(-1);
    return Response.json({...result,next:hasMore && last ? {before:last.created_at,before_id:last.id} : null},{headers});
  } catch { return Response.json({error:'Notifications could not be refreshed. Try again.'},{status:503,headers}); }
};
export const POST: APIRoute = async ({locals,request}) => {
  if (!sameOrigin(request)) return Response.json({error:'Invalid origin.'},{status:403,headers});
  const payload = await readBoundedJsonObject(request,4096);
  if (!payload.ok) return Response.json({error:payload.error},{status:payload.status,headers});
  const ids = payload.value.ids;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 30 || !ids.every(id=>typeof id==='string' && uuid.test(id))) return Response.json({error:'Choose up to 30 notifications.'},{status:400,headers});
  try {
    const actor = await session(locals);
    if (!actor?.profileId) return Response.json({error:'Sign in to update notifications.'},{status:401,headers});
    const rows = await actor.sql`update app.notifications set read_at=coalesce(read_at,now()) where profile_id=${actor.profileId}::uuid and id=any(${ids}::uuid[]) returning id`;
    return Response.json({ok:true,marked:rows.map(row=>row.id)},{headers});
  } catch { return Response.json({error:'Could not mark notifications as read.'},{status:503,headers}); }
};

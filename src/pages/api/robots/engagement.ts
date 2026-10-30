import type { APIRoute } from 'astro';
import { z } from 'zod';
import { sameOrigin, ensureAuthenticatedProfile } from '@/lib/auth';
import { sqlClient } from '@/lib/db';
import { consumeRateLimit, requestNetworkHash } from '@/lib/rate-limit';
import { readBoundedJsonObject } from '@/lib/bounded-json';
const headers={'cache-control':'private, no-store'};
const input=z.discriminatedUnion('action',[
  z.object({id:z.uuid(),action:z.literal('view')}).strict(),
  z.object({id:z.uuid(),action:z.literal('like'),liked:z.boolean()}).strict(),
]);
export const POST:APIRoute=async({locals,request})=>{
  if(!sameOrigin(request))return Response.json({error:'Invalid origin'},{status:403,headers});
  const sql=sqlClient(locals);if(!sql)return Response.json({error:'Service unavailable'},{status:503,headers});
  const body=await readBoundedJsonObject(request,1024);const data=body.ok?input.safeParse(body.value):null;
  if(!data?.success)return Response.json({error:'Invalid request'},{status:422,headers});
  if(data.data.action==='like'&&!(await ensureAuthenticatedProfile(locals,sql)))return Response.json({error:'Sign in to like this product.'},{status:401,headers});
  const rate=await consumeRateLimit(locals,request,sql,'robots.engagement',300,3600);
  if(rate!=='allowed')return Response.json({error:'Please try again later.'},{status:rate==='limited'?429:503,headers});
  const d=data.data;
  // Rotate the pseudonymous key daily; never store raw network addresses.
  const hash=d.action==='view'?await requestNetworkHash(locals,request,'robot-view:'+new Date().toISOString().slice(0,10)):null;
  if(d.action==='view'&&!hash)return Response.json({error:'Service unavailable'},{status:503,headers});
  try{const rows=await sql`select app.robot_engagement(${d.id}::uuid,${d.action},${hash},${d.action==='like'?d.liked:null}::boolean) as metrics`;return Response.json(rows[0]?.metrics,{headers});}
  catch(error){const absent=error instanceof Error&&error.message.includes('entry_unavailable');return Response.json({error:absent?'Entry unavailable':'Please try again.'},{status:absent?404:503,headers});}
};

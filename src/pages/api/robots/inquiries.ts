import type { APIRoute } from 'astro';
import { z } from 'zod';
import { readBoundedJsonObject } from '@/lib/bounded-json';
import { authorizeProductEditor, productPrivateHeaders as headers, productError } from '@/lib/product-http';
const input=z.discriminatedUnion('action',[
  z.object({action:z.literal('send'),id:z.uuid(),creation_key:z.uuid(),topic:z.enum(['general','technical','availability','partnership']),message:z.string().trim().min(10).max(2000),reply_email:z.email().max(254),consent:z.literal(true)}).strict(),
  z.object({action:z.literal('status'),id:z.uuid(),status:z.enum(['new','replied','archived'])}).strict(),
]);
export const GET:APIRoute=async({locals,request,url})=>{
  const auth=await authorizeProductEditor(locals,request);if(!auth.ok)return auth.response;
  const d=z.object({organization_id:z.uuid(),offset:z.coerce.number().int().min(0).max(10000).default(0)}).safeParse(Object.fromEntries(url.searchParams));
  if(!d.success)return Response.json({error:'Invalid request'},{status:422,headers});
  try{const r=await auth.sql`select app.robot_inquiry_inbox(${d.data.organization_id}::uuid,${d.data.offset}) as inbox`;return Response.json(r[0]?.inbox,{headers});}catch(e){return productError(e);}
};
export const POST:APIRoute=async({locals,request})=>{
  const auth=await authorizeProductEditor(locals,request);if(!auth.ok)return auth.response;
  const body=await readBoundedJsonObject(request,12000);const parsed=body.ok?input.safeParse(body.value):null;
  if(!parsed?.success)return Response.json({error:'Add your message, reply email and permission to share them.'},{status:422,headers});
  const d=parsed.data;
  try{
    if(d.action==='status'){await auth.sql`select app.set_robot_inquiry_status(${d.id}::uuid,${d.status})`;return Response.json({saved:true},{headers});}
    const r=await auth.sql`select app.send_robot_inquiry(${d.id}::uuid,${d.creation_key}::uuid,${d.topic},${d.message},${d.reply_email},${d.consent}) as id`;
    return Response.json({id:r[0]?.id},{headers});
  }catch(e){
    const message=e instanceof Error?e.message:'';
    if(message.includes('inquiry_limit_reached'))return Response.json({error:'Your daily inquiry allowance is used. Try again tomorrow.'},{status:429,headers});
    if(message.includes('inquiry_unavailable'))return Response.json({error:'This company is not accepting inquiries yet.'},{status:409,headers});
    if(message.includes('inquiry_conflict'))return Response.json({error:'This inquiry was already sent. Start a new inquiry for a different message.'},{status:409,headers});
    return productError(e);
  }
};

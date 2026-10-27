import type { APIRoute } from 'astro';
import { z } from 'zod';
import { readBoundedJsonObject } from '@/lib/bounded-json';
import { authorizeProductEditor, productError, productPrivateHeaders as headers } from '@/lib/product-http';
const input=z.object({robot_id:z.uuid(),publish:z.boolean(),stage:z.enum(['concept','prototype','testing','production','research'])}).strict();
export const POST:APIRoute=async({locals,request})=>{
 const auth=await authorizeProductEditor(locals,request);if(!auth.ok)return auth.response;
 const body=await readBoundedJsonObject(request,2048);const parsed=body.ok?input.safeParse(body.value):null;
 if(!parsed?.success)return Response.json({error:'Choose the Robot and build stage.'},{status:422,headers});
 try{const d=parsed.data;await auth.sql`select app.set_robot_publication(${d.robot_id}::uuid,${d.publish},${d.stage})`;return Response.json({ok:true},{headers});}catch(error){return productError(error);}
};

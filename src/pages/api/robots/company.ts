import type { APIRoute } from 'astro';
import { z } from 'zod';
import { readBoundedJsonObject } from '@/lib/bounded-json';
import { authorizeProductEditor, productError, productPrivateHeaders as headers } from '@/lib/product-http';
import { publicHttpsUrl } from '@/lib/products';
const input=z.discriminatedUnion('action',[
 z.object({action:z.literal('remove-member'),reference_id:z.uuid(),profile_id:z.uuid()}).strict(),
 z.object({action:z.literal('request'),reference_id:z.uuid(),organization_id:z.uuid().nullable(),handle:z.string().max(40),notes:z.string().trim().min(10).max(4000),evidence_url:z.string().max(2048),authorized:z.literal(true)}).strict(),
 z.object({action:z.literal('confirm'),request_id:z.uuid(),authorized:z.literal(true)}).strict(),
 z.object({action:z.literal('review'),request_id:z.uuid(),approve:z.boolean(),reason:z.string().trim().min(10).max(2000)}).strict(),
 z.object({action:z.literal('prepare'),reference_id:z.uuid(),company_id:z.uuid(),organization_id:z.uuid()}).strict(),
]);
export const POST:APIRoute=async({locals,request})=>{
 const auth=await authorizeProductEditor(locals,request);if(!auth.ok)return auth.response;
 const body=await readBoundedJsonObject(request,8192);const result=body.ok?input.safeParse(body.value):null;
 if(!result?.success)return Response.json({error:'Review the required details.'},{status:422,headers});
 const d=result.data;try{
  let data:unknown;
  if(d.action==='request'){
   const evidence=d.evidence_url?publicHttpsUrl(d.evidence_url):'';
   const rows=await auth.sql`select app.start_robot_company_request(${d.reference_id}::uuid,${d.organization_id}::uuid,${d.handle},${d.notes},${evidence},${d.authorized}) as result`;data=rows[0]?.result;
  }else if(d.action==='confirm'){
   const rows=await auth.sql`select app.confirm_robot_company_claim(${d.request_id}::uuid,${d.authorized}) as result`;data=rows[0]?.result;
  }else if(d.action==='review'){
   const rows=await auth.sql`select app.review_robot_company_request(${d.request_id}::uuid,${d.approve},${d.reason}) as result`;data=rows[0]?.result;
  }else if(d.action==='remove-member'){
   const rows=await auth.sql`select app.remove_robot_company_member(${d.reference_id}::uuid,${d.profile_id}::uuid) as result`;data=rows[0]?.result;
  }else{
   const rows=await auth.sql`select app.prepare_reference_product(${d.reference_id}::uuid,${d.company_id}::uuid,${d.organization_id}::uuid) as id`;data={product_id:rows[0]?.id};
  }
  return Response.json({result:data},{headers});
 }catch(error){const message=error instanceof Error?error.message:'';
  if(/claim_website_proof_required/u.test(message))return Response.json({error:'Verify control of the company’s listed website before confirming. Otherwise, leave your request for authority review.'},{status:403,headers});
  if(/company_already_claimed/u.test(message))return Response.json({error:'This company already has an owner. Reload to request access.'},{status:409,headers});
  return productError(error);
 }
};

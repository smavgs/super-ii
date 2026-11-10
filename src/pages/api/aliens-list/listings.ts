import type { APIRoute } from 'astro';
import { z } from 'zod';
import { readBoundedJsonObject } from '@/lib/bounded-json';
import { alienJson,alienError,alienSession,alienWriter } from '@/lib/aliens/http';
import { listingDocument,parseFilters,publicationIssues } from '@/lib/aliens/input';
export const GET:APIRoute=async({locals,url})=>{try{
 const {sql}=await alienSession(locals);const id=url.searchParams.get('id');
 if(id){if(!z.uuid().safeParse(id).success)return alienJson({error:'Invalid listing.'},400);const r=await sql`select app.alien_detail(${id}::uuid) as item`;return r[0]?.item?alienJson(r[0].item):alienJson({error:'Listing not found.'},404);}
 const filters=parseFilters(url.searchParams),page=z.coerce.number().int().min(0).max(200).parse(url.searchParams.get('page')??0);
 const rows=await sql`select app.alien_browse(${JSON.stringify(filters)}::jsonb,${page}) as page`;return alienJson(rows[0].page);
}catch(e){return e instanceof z.ZodError?alienJson({error:'Check your search filters.'},400):alienError(e);}};
export const POST:APIRoute=async({locals,request})=>{try{
 const auth=await alienWriter(locals,request);if(auth.error)return auth.error;
 const body=await readBoundedJsonObject(request,30000);if(!body.ok)return alienJson({error:body.error},body.status);
 const parsed=z.object({id:z.uuid(),version:z.number().int().min(0),action:z.enum(['save','publish','renew','sold','remove']),document:listingDocument.optional()}).strict().parse(body.value);
 if(['save','publish'].includes(parsed.action)&&!parsed.document)return alienJson({error:'Add your listing details.'},400);
 if(parsed.action==='publish'&&parsed.document){const issues=publicationIssues(parsed.document);if(issues.length)return alienJson({error:issues.join(' ')},400);}
 const rows=await auth.sql`select app.alien_save_listing(${parsed.id}::uuid,${parsed.version},${parsed.action},${JSON.stringify(parsed.document??{})}::jsonb) as item`;
 return alienJson(rows[0].item);
}catch(e){return e instanceof z.ZodError?alienJson({error:e.issues[0]?.message??'Check the listing fields.'},400):alienError(e);}};

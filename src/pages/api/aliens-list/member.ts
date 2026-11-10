import type {APIRoute} from 'astro';
import {z} from 'zod';
import {readBoundedJsonObject} from '@/lib/bounded-json';
import {alienJson,alienError,alienSession,alienWriter} from '@/lib/aliens/http';
import {searchFilters} from '@/lib/aliens/input';
import {alienMailConfig} from '@/lib/aliens/mail';
const uuid=z.uuid();
const actions=z.discriminatedUnion('action',[
 z.object({action:z.literal('message'),id:uuid,listing:uuid.nullable(),thread:uuid.nullable(),body:z.string().trim().min(1).max(4000)}).strict(),
 z.object({action:z.literal('read'),thread:uuid,through:z.iso.datetime({offset:true})}).strict(),
 z.object({action:z.literal('block'),profile:uuid,active:z.boolean()}).strict(),
 z.object({action:z.literal('report'),listing:uuid.nullable(),message:uuid.nullable(),reason:z.string().trim().min(5).max(2000)}).strict(),
 z.object({action:z.literal('search'),id:uuid,name:z.string().trim().min(1).max(100),filters:searchFilters,remove:z.boolean().default(false)}).strict(),
 z.object({action:z.literal('email'),enabled:z.boolean()}).strict(),
 z.object({action:z.literal('moderate'),report:uuid,operation:z.enum(['hide','resolve','restore'])}).strict(),
]);
export const GET:APIRoute=async({locals,url})=>{try{
 const {sql,profileId,signedIn}=await alienSession(locals);if(!signedIn)return alienJson({error:'Sign in to continue.'},401);
 if(!profileId)return url.searchParams.has('thread')||url.searchParams.has('moderate')?alienJson({error:'Not found.'},404):alienJson({profile_id:null,admin:false,listings:[],threads:[],searches:[],listings_total:0,threads_total:0,unread_total:0,page:0,size:25,email_enabled:false,email_available:!!alienMailConfig(locals)});
 const thread=url.searchParams.get('thread');
 if(thread){uuid.parse(thread);const before=url.searchParams.get('before'),beforeId=url.searchParams.get('before_id');if(before){z.iso.datetime({offset:true}).parse(before);uuid.parse(beforeId);}else if(beforeId)return alienJson({error:'Invalid page cursor.'},400);
 const r=await sql`select app.alien_thread(${thread}::uuid,${before}::timestamptz,${beforeId}::uuid) as thread`;return r[0]?.thread?alienJson(r[0].thread):alienJson({error:'Conversation not found.'},404);}
 if(url.searchParams.get('moderate')==='1'){const r=await sql`select app.alien_moderate() as reports`;return alienJson(r[0].reports);}
 const page=z.coerce.number().int().min(0).max(200).parse(url.searchParams.get('page')??0);
 const r=await sql`select app.alien_mine(${page}) as mine`;return alienJson({...r[0].mine,email_available:!!alienMailConfig(locals)});
}catch(e){return e instanceof z.ZodError?alienJson({error:'Invalid request.'},400):alienError(e);}};
export const POST:APIRoute=async({locals,request})=>{try{
 const auth=await alienWriter(locals,request);if(auth.error)return auth.error;
 const body=await readBoundedJsonObject(request,8000);if(!body.ok)return alienJson({error:body.error},body.status);
 const d=actions.parse(body.value);let result:unknown={ok:true};
 if(d.action==='message'){if(!d.thread&&!d.listing)return alienJson({error:'Choose a listing.'},400);const r=await auth.sql`select app.alien_message(${d.id}::uuid,${d.listing}::uuid,${d.thread}::uuid,${d.body}) as result`;result=r[0].result;}
 if(d.action==='read')await auth.sql`select app.alien_mark_read(${d.thread}::uuid,${d.through}::timestamptz)`;
 if(d.action==='block')await auth.sql`select app.alien_block(${d.profile}::uuid,${d.active})`;
 if(d.action==='report'){const r=await auth.sql`select app.alien_report(${d.listing}::uuid,${d.message}::uuid,${d.reason}) as id`;result={id:r[0].id};}
 if(d.action==='search'){const r=await auth.sql`select app.alien_save_search(${d.id}::uuid,${d.name},${JSON.stringify(d.filters)}::jsonb,${d.remove}) as id`;result={id:r[0].id};}
 if(d.action==='email'){
  let email:string|null=null;
  if(d.enabled){if(!alienMailConfig(locals))return alienJson({error:'Email alerts are unavailable. Bell alerts remain active.'},503);
   const user=await locals.currentUser?.();const primary=user?.emailAddresses.find(e=>e.id===user.primaryEmailAddressId&&e.verification?.status==='verified');
   if(!primary)return alienJson({error:'Verify your primary account email first.'},400);email=primary.emailAddress;
  }
  await auth.sql`select app.alien_set_email(${d.enabled},${email})`;
 }
 if(d.action==='moderate'){const r=await auth.sql`select app.alien_moderate(${d.report}::uuid,${d.operation}) as result`;result=r[0].result;}
 return alienJson(result);
}catch(e){return e instanceof z.ZodError?alienJson({error:'Check the fields and try again.'},400):alienError(e);}};

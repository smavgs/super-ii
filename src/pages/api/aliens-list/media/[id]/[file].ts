import type {APIRoute} from 'astro';
import {z} from 'zod';
import {alienSession} from '@/lib/aliens/http';
import {showcaseBucket} from '@/lib/showcase-media';
export const GET:APIRoute=async({locals,params})=>{
 const headers={'cache-control':'private, no-store','x-content-type-options':'nosniff'};
 if(!z.uuid().safeParse(params.id).success||!/^([a-f0-9]{64})\.jpg$/.test(params.file??''))return new Response(null,{status:404,headers});
 try{const {sql}=await alienSession(locals);const bucket=showcaseBucket();if(!bucket)return new Response(null,{status:503,headers});
 const r=await sql`select app.alien_photo(${params.id}::uuid,${params.file!.slice(0,-4)},'read') as ok`;
 if(!r[0]?.ok)return new Response(null,{status:404,headers});
 const image=await bucket.get(`aliens/${params.id}/${params.file}`);return image?new Response(image.body,{headers:{...headers,'content-type':'image/jpeg','content-length':String(image.size)}}):new Response(null,{status:404,headers});
 }catch{return new Response(null,{status:503,headers});}
};

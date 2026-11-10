import type {APIRoute} from 'astro';
import {z} from 'zod';
import {alienWriter,alienJson,alienError} from '@/lib/aliens/http';
import {showcaseBucket,readBoundedShowcasePhoto} from '@/lib/showcase-media';
import {stripJpegMetadata,jpegDimensions,cardPhotoSha256} from '@/lib/card-photo';
export const POST:APIRoute=async({locals,request,params})=>{try{
 if(!z.uuid().safeParse(params.id).success)return alienJson({error:'Invalid listing.'},400);
 const a=await alienWriter(locals,request);if(a.error)return a.error;
 const bucket=showcaseBucket();if(!bucket)return alienJson({error:'Photo storage is unavailable.'},503);
 const bytes=stripJpegMetadata(await readBoundedShowcasePhoto(request));const size=jpegDimensions(bytes);
 if(size.width<320||size.height<240||size.width>2400||size.height>2400)return alienJson({error:'Use a photo at least 320 × 240 pixels.'},400);
 const hash=await cardPhotoSha256(bytes);
 const r=await a.sql`select app.alien_photo(${params.id}::uuid,${hash},'check') as ok`;if(!r[0]?.ok)return alienJson({error:'This is not your draft.'},403);
 await bucket.put(`aliens/${params.id}/${hash}.jpg`,bytes,{httpMetadata:{contentType:'image/jpeg'}});
 await a.sql`select app.alien_photo(${params.id}::uuid,${hash},'add')`;
 return alienJson({hash},201);
}catch(e){return alienError(e);}};

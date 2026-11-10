import { ensureAuthenticatedProfile,sameOrigin } from '../auth';
import { sqlClient,setSqlActorContext } from '../db';
import { consumeIdentityRateLimit } from '../rate-limit';
export const alienJson=(value:unknown,status=200)=>Response.json(value,{status,headers:{'cache-control':'private, no-store','vary':'Cookie'}});
export async function alienSession(locals:App.Locals) {
 const sql=sqlClient(locals);if(!sql)throw new Error('alien_unavailable');
 const a=typeof locals.auth==='function'?locals.auth():null;
 const userId=a&&'userId'in a?a.userId:null;
 if(!userId)return {sql,profileId:null,signedIn:false};
 const rows=await sql`select id from app.profiles where clerk_user_id=${userId} limit 1`;
 const profileId=rows[0]?.id as string|undefined;
 if(profileId)setSqlActorContext(sql,{actorKind:'clerk',clerkUserId:userId,profileId});
 return {sql,profileId:profileId??null,signedIn:true};
}
export async function alienWriter(locals:App.Locals,request:Request) {
 if(!sameOrigin(request))return {error:alienJson({error:'This request must come from Super ii.'},403)} as const;
 const sql=sqlClient(locals);if(!sql)return {error:alienJson({error:'Please try again shortly.'},503)} as const;
 const profile=await ensureAuthenticatedProfile(locals,sql);if(!profile)return {error:alienJson({error:'Sign in to continue.'},401)} as const;
 const rate=await consumeIdentityRateLimit(locals,sql,profile.profileId,'aliens.write',180,3600);
 if(rate!=='allowed')return {error:alienJson({error:rate==='limited'?'You have reached the hourly limit. Try later.':'Please try again shortly.'},rate==='limited'?429:503)} as const;
 return {sql,profile} as const;
}
const errors:Record<string,[number,string]>={alien_invalid:[400,'Check the required fields and try again.'],alien_sign_in:[401,'Sign in to continue.'],alien_not_allowed:[403,'This action is not available to your account.'],alien_not_found:[404,'This item is not available.'],alien_not_available:[409,'This listing is no longer accepting new inquiries.'],alien_conflict:[409,'This changed in another tab. Reload before saving.'],alien_hidden:[403,'This listing has been hidden. Contact Super ii for help.'],alien_event_ended:[400,'The event has already ended.'],alien_duplicate:[409,'An active listing already exists for this item or event.'],alien_limit:[429,'You have reached the daily limit. New members can post 3 listings and start 5 conversations per day.'],alien_photo_limit:[429,'This draft has reached its photo upload limit.'],alien_photo_missing:[400,'Upload your photos before publishing.'],alien_kind_fixed:[400,'Create a new listing to change its type.'],alien_own_listing:[400,'This is your own listing.'],alien_blocked:[403,'Messaging is unavailable for this conversation.']};
export function alienError(error:unknown) {const message=error instanceof Error?error.message:'';const item=Object.entries(errors).find(([key])=>message.includes(key))?.[1];return alienJson({error:item?.[1]??'Could not complete this request. Please try again.'},item?.[0]??503);}

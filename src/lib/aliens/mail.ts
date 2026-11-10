import {sqlClient,runtimeValue} from '../db';
import {sigmaMailConfig,sendSigmaMail} from '../sigma-email';
export function alienMailConfig(locals:App.Locals) {
 const existing=sigmaMailConfig(locals);if(!existing)return null;
 const from=runtimeValue(locals,'ALIENS_EMAIL_FROM')??existing.from.replace(/^[^<]+</,'Super ii <');
 return /[\r\n]/.test(from)?null:{...existing,from};
}
async function key(secret:string) {return crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);}
export async function alienEmailToken(secret:string,id:string,nonce:string) {
 const bytes=await crypto.subtle.sign('HMAC',await key(secret),new TextEncoder().encode(`aliens-email-v1\n${id}\n${nonce}`));
 return `${id}.${nonce}.${Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('')}`;
}
export async function verifyAlienEmailToken(secret:string,token:string) {
 const m=token.match(/^([a-f0-9-]{36})\.([a-f0-9-]{36})\.([a-f0-9]{64})$/);if(!m)return null;
 return await crypto.subtle.verify('HMAC',await key(secret),Uint8Array.from(m[3].match(/../g)!,b=>parseInt(b,16)),new TextEncoder().encode(`aliens-email-v1\n${m[1]}\n${m[2]}`))?{id:m[1],nonce:m[2]}:null;
}
export async function maintainAliens(locals:App.Locals) {
 const sql=sqlClient(locals);if(!sql)return;
 const rows=await sql`select app.alien_maintenance() as deliveries`;
 const config=alienMailConfig(locals);if(!config)return;
 const deliveries=rows[0]?.deliveries as Array<{id:string;profile_id:string;email:string;token:string}>??[];
 for(const d of deliveries){
  const token=await alienEmailToken(config.secret,d.profile_id,d.token);
  const unsubscribe=`${config.origin}/aliens-list/email?token=${encodeURIComponent(token)}`;
  const inbox=`${config.origin}/aliens-list/mine`;
  try{await sendSigmaMail(config,{to:d.email,key:`aliens-digest-${d.id}`,subject:'Your Aliens List updates',
   text:`There are unread Aliens List updates in your Super ii account. Open your messages, saved searches and listings: ${inbox}\n\nTurn off Aliens List email alerts: ${unsubscribe}`,
   html:`<h1>Aliens List 👾</h1><p>There are unread updates in your Super ii account.</p><p><a href="${inbox}">Open Aliens List</a></p><p><a href="${unsubscribe}">Turn off email alerts</a></p>`});
   await sql`select app.alien_digest_sent(${d.id}::uuid)`;
  }catch{console.warn('Aliens List digest delivery deferred');}
 }
}

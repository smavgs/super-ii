import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {build} from 'esbuild';
import {resolve,join} from 'node:path';
import {rm,readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import sharp from 'sharp';
import {queryDatabase as db} from './lib/connection-test-db.mjs';
const root=resolve(import.meta.dirname,'..'),bundle=join(root,'node_modules',`.aliens-test-${process.pid}.mjs`);
const definitions={listings:'src/pages/api/aliens-list/listings.ts',member:'src/pages/api/aliens-list/member.ts',upload:'src/pages/api/aliens-list/media/[id]/index.ts',photo:'src/pages/api/aliens-list/media/[id]/[file].ts',input:'src/lib/aliens/input.ts',mail:'src/lib/aliens/mail.ts',time:'src/lib/aliens/event-time.ts'};
globalThis.__alienTestBucket=new Map();
await build({stdin:{resolveDir:root,contents:Object.entries(definitions).map(([key,path])=>`export * as ${key} from ${JSON.stringify(resolve(root,path))};`).join('\n')},outfile:bundle,bundle:true,platform:'node',format:'esm',packages:'external',logLevel:'silent',plugins:[{name:'isolated-services',setup(b){b.onResolve({filter:/^(?:@\/lib\/db|\.\.\/db|\.\/db)$/},()=>({path:join(root,'tools/lib/connection-test-db.mjs')}));b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'cloudflare-test',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:`export const env={SHOWCASE_MEDIA:{put:async(k,v)=>globalThis.__alienTestBucket.set(k,v),get:async(k)=>{const value=globalThis.__alienTestBucket.get(k);return value?{body:value,size:value.length}:null;}}};`}));}}]});
const r=await import(pathToFileURL(bundle).href),run=randomUUID().slice(0,8),names=['seller','buyer','other','admin'].map(n=>`aliens-${n}-${run}`),actors={};
const env={RESEND_API_KEY:'test-only-key',SIGMA_EMAIL_FROM:'Super ii <test@example.test>',SIGMA_TOKEN_SECRET:'isolated-aliens-token-secret-at-least-32-characters',SIGMA_PUBLIC_ORIGIN:'https://example.test'};
const origin='https://example.test',quote=v=>"'"+String(v).replaceAll("'","''")+"'",owner=q=>db(q,null,true);
function locals(name){return {__testActor:actors[name]??{actorKind:'public'},__testEnv:env,auth:()=>({userId:name??null}),currentUser:async()=>name?{id:name,username:name,firstName:'Aliens',lastName:'Fixture',imageUrl:null,primaryEmailAddressId:'email',emailAddresses:[{id:'email',emailAddress:name+'@example.test',verification:{status:'verified'}}]}:null};}
async function call(route,name,body,opts={}){const url=new URL(opts.path??`/api/aliens-list/${route}`,origin);const request=new Request(url,{method:body===undefined?'GET':'POST',headers:{origin:opts.origin??origin,'content-type':opts.type??'application/json'},...(body===undefined?{}:{body:opts.raw??JSON.stringify(body)})});return r[route][body===undefined?'GET':'POST']({locals:locals(name),request,url,params:opts.params??{}});}
async function ok(response){assert(response.ok,`${response.status}: ${await response.clone().text()}`);return response.json();}
const save=(who,id,version,action,document)=>call('listings',who,{id,version,action,...(document?{document}:{})});
const post=(who,body)=>call('member',who,body);
const getItem=(who,id)=>call('listings',who,undefined,{path:'/api/aliens-list/listings?id='+id});
const draft=(patch={})=>r.input.listingDocument.parse({kind:'sale',title:`Workstation ${run}`,description:'A useful computer for a new project. Includes its power supply.',category:'workstation',condition:'used',amount:500,currency:'USD',delivery:['pickup'],city:'San Francisco',country:'US',lat:37.774929,lon:-122.419416,original_photos:true,...patch});
const requestMessage=(who,listing,thread,body='Is it available?',id=randomUUID())=>post(who,{action:'message',listing,thread,body,id});
let checks=0;const expectStatus=async(p,n)=>{const response=await p;assert.equal(response.status,n,await response.clone().text());checks++;return response;};
const originalFetch=globalThis.fetch;const sent=[];
globalThis.fetch=async(url,init)=>{assert.equal(url,'https://api.resend.com/emails','No external network in integration tests');sent.push({body:JSON.parse(init.body),key:init.headers['Idempotency-Key']});return Response.json({id:'mock-'+sent.length});};
try{
 for(const name of names){const rows=await db(`select app.ensure_profile(${quote(name)},${quote(name)},'Aliens fixture',null) as id`,{actorKind:'clerk',clerkUserId:name});actors[name]={actorKind:'clerk',clerkUserId:name,profileId:rows[0].id,isAdmin:name===names[3]};}
 const [seller,buyer,other,admin]=names,id=randomUUID();let d=draft();
 assert.equal(r.time.utcDate('2027-03-14T00:00','America/Los_Angeles'),'2027-03-14T08:00:00.000Z');assert.equal(r.time.lastEventDate('2027-03-15T07:00:00Z','America/Los_Angeles').slice(0,10),'2027-03-14');assert.throws(()=>r.time.utcDate('2027-03-14T02:30','America/Los_Angeles'));checks+=3;
 const newcomer=await ok(await call('member','new-member-without-profile'));assert.deepEqual(newcomer.listings,[]);assert.equal(newcomer.profile_id,null);checks+=2;
 for(const entry of JSON.parse(await readFile(join(root,'src/data/aliens/official-events.json'),'utf8'))){const normalized=r.input.listingDocument.parse(entry.document);assert.equal(normalized.all_day,true);const rows=await owner(`select app.alien_valid_document(${quote(JSON.stringify(normalized))}::jsonb,true) as valid`);assert.equal(rows[0].valid,true);checks+=2;}
 await expectStatus(save(null,id,0,'save',d),401);
 await expectStatus(call('listings',seller,{id,version:0,action:'save',document:d},{origin:'https://evil.example'}),403);
 await expectStatus(call('listings',seller,{}, {raw:'x'.repeat(31000)}),413);
 await expectStatus(save(seller,id,0,'publish',d),400);
 let item=await ok(await save(seller,id,0,'save',d));assert.equal(item.version,1);assert.equal(item.document.lat,37.78);assert.equal(item.document.lon,-122.42);checks+=3;
 await expectStatus(getItem(null,id),404);await expectStatus(getItem(other,id),404);
 await expectStatus(save(other,id,1,'remove'),403);
 await assert.rejects(()=>db('select * from app.alien_messages',actors[other]));checks++;
 // Upload real generated JPEG bytes through the application, with isolated object storage.
 for(const color of ['#aaff00','#aa00ff']){const jpeg=await sharp({create:{width:640,height:480,channels:3,background:color}}).jpeg().toBuffer();const response=await call('upload',seller,{}, {raw:jpeg,type:'image/jpeg',params:{id}});const photo=await ok(response);d.photos.push(photo.hash);}
 assert.equal(globalThis.__alienTestBucket.size,2);checks++;
 await expectStatus(call('photo',null,undefined,{params:{id,file:d.photos[0]+'.jpg'}}),404);
 await expectStatus(call('photo',seller,undefined,{params:{id,file:d.photos[0]+'.jpg'}}),200);
 const searchId=randomUUID(),filters={kind:'hardware',q:'workstation',lat:37.77,lon:-122.42,radius:50};
 await ok(await post(buyer,{action:'search',id:searchId,name:'Workstation nearby',filters,remove:false}));
 const duplicateSearch=await ok(await post(buyer,{action:'search',id:randomUUID(),name:'Same search',filters,remove:false}));assert.equal(duplicateSearch.id,searchId);checks++;
 item=await ok(await save(seller,id,item.version,'publish',d));assert.equal(item.status,'active');
 const publicItem=await ok(await getItem(null,id));assert.equal(publicItem.document.lat,37.78);assert(!JSON.stringify(publicItem).includes('@example.test'));checks+=2;
 await expectStatus(call('photo',null,undefined,{params:{id,file:d.photos[0]+'.jpg'}}),200);
 let browse=await ok(await call('listings',null,undefined,{path:'/api/aliens-list/listings?kind=hardware&lat=37.77&lon=-122.42&radius=10'}));assert(browse.items.some(x=>x.id===id));checks++;
 browse=await ok(await call('listings',null,undefined,{path:'/api/aliens-list/listings?kind=hardware&lat=0&lon=0&radius=5'}));assert(!browse.items.some(x=>x.id===id));checks++;
 await expectStatus(call('listings',null,undefined,{path:'/api/aliens-list/listings?lat=NaN&lon=0'}),400);
 const notifications=await db("select event_type from app.notifications where event_type='aliens.match'",actors[buyer]);assert.equal(notifications.length,1);checks++;
 await expectStatus(save(seller,id,1,'remove'),409);
 await expectStatus(save(seller,id,item.version,'save',{...d,title:''}),400);
 const messageId=randomUUID(),message=await ok(await requestMessage(buyer,id,null,'Hello, is this available?',messageId));
 const retry=await ok(await requestMessage(buyer,id,null,'Hello, is this available?',messageId));assert.deepEqual(retry,message);checks++;
 await expectStatus(requestMessage(buyer,id,null,'Changed body',messageId),409);
 await expectStatus(call('member',other,undefined,{path:'/api/aliens-list/member?thread='+message.thread_id}),404);
 await expectStatus(requestMessage(other,null,message.thread_id,'Intruder'),404);
 const reply=await ok(await requestMessage(seller,null,message.thread_id,'Yes. <script>not HTML</script>'));
 const thread=await ok(await call('member',buyer,undefined,{path:'/api/aliens-list/member?thread='+message.thread_id}));assert.equal(thread.messages.length,2);assert.equal(thread.messages[1].body,'Yes. <script>not HTML</script>');checks+=2;
 await ok(await post(buyer,{action:'read',thread:message.thread_id,through:thread.messages.at(-1).created_at}));
 const unread=await db("select count(*)::int n from app.notifications where event_type='aliens.message' and read_at is null",actors[buyer]);assert.equal(unread[0].n,0);checks++;
 await ok(await post(buyer,{action:'block',profile:actors[seller].profileId,active:true}));
 await expectStatus(requestMessage(seller,null,message.thread_id),403);await expectStatus(requestMessage(buyer,null,message.thread_id),403);
 await ok(await post(buyer,{action:'block',profile:actors[seller].profileId,active:false}));await expectStatus(requestMessage(seller,null,message.thread_id,'Now unblocked.'),200);
 await expectStatus(post(other,{action:'report',listing:null,message:reply.message_id,reason:'Should not see this'}),404);
 const report=await ok(await post(buyer,{action:'report',listing:null,message:reply.message_id,reason:'Test a reported message'}));
 await expectStatus(call('member',buyer,undefined,{path:'/api/aliens-list/member?moderate=1'}),403);
 const reports=await ok(await call('member',admin,undefined,{path:'/api/aliens-list/member?moderate=1'}));assert.equal(reports.find(x=>x.id===report.id).reported_message,'Yes. <script>not HTML</script>');checks++;
 await ok(await post(admin,{action:'moderate',report:report.id,operation:'resolve'}));
 item=await ok(await save(seller,id,item.version,'sold'));await expectStatus(requestMessage(other,id,null),409);await expectStatus(requestMessage(seller,null,message.thread_id,'Conversation still works.'),200);
 item=await ok(await save(seller,id,item.version,'renew'));assert.equal(item.status,'active');checks++;
 await owner(`update app.alien_listings set expires_at=now()-interval '1 hour' where id=${quote(id)} returning id`);
 const expired=await ok(await getItem(null,id));assert.equal(expired.status,'expired');checks++;
 await db('select app.alien_maintenance()',actors[admin]);
 const reminders=await db("select count(*)::int n from app.notifications where event_type='aliens.expiry'",actors[seller]);assert.equal(reminders[0].n,1);checks++;
 item=await ok(await save(seller,id,item.version,'sold'));const closedReminder=await db("select count(*)::int n from app.notifications where event_type='aliens.expiry' and needs_action",actors[seller]);assert.equal(closedReminder[0].n,0);checks++;
 item=await ok(await save(seller,id,item.version,'renew'));
 // Event restrictions and duplicate detection work without a listing fee or photo requirement.
 const start=new Date(Date.now()+7*864e5).toISOString(),end=new Date(Date.now()+7*864e5+3600e3).toISOString();
 const event=draft({kind:'event',title:'Builder event '+run,category:'ai',condition:'',photos:[],amount:null,delivery:[],starts_at:start,ends_at:end,timezone:'America/Los_Angeles',organizer:'Fixture organizers',registration_url:'https://example.test/event-'+run});
 const eventId=randomUUID();await expectStatus(save(seller,eventId,0,'publish',{...event,city:'London',country:'GB'}),400);
 await expectStatus(save(seller,eventId,0,'publish',{...event,ends_at:'2020-01-01T00:00:00Z'}),400);
 await expectStatus(save(seller,eventId,0,'publish',event),200);
 await expectStatus(save(other,randomUUID(),0,'publish',{...event,title:'Duplicate event '+run}),409);
 const wantedId=randomUUID();await expectStatus(save(seller,wantedId,0,'publish',draft({kind:'wanted',title:'Wanted GPU '+run,category:'gpu',photos:[],amount:null})),200);
 await expectStatus(save(seller,randomUUID(),0,'publish',draft({kind:'wanted',title:'Fourth listing '+run,photos:[]})),429);
 const bypassId=randomUUID(),bypass=await ok(await save(seller,bypassId,0,'save',draft({kind:'wanted',title:'Draft bypass '+run,photos:[]})));
 await expectStatus(save(seller,bypassId,bypass.version,'renew'),400);await expectStatus(save(seller,bypassId,bypass.version,'sold'),400);
 const secondEvent=await ok(await save(other,randomUUID(),0,'publish',{...event,title:'Different event '+run,registration_url:'https://example.test/different-'+run}));
 await expectStatus(save(other,secondEvent.id,secondEvent.version,'save',event),409);
 // Email choice uses verified account email only; provider is mocked.
 await expectStatus(post(buyer,{action:'email',enabled:true,email:'intruder@example.test'}),400);
 await ok(await post(buyer,{action:'email',enabled:true}));
 await owner(`update app.alien_preferences set digest_after=now()-interval '2 days' where profile_id=${quote(actors[buyer].profileId)} returning profile_id`);
 await requestMessage(seller,null,message.thread_id,'An unread update for the digest.');
 await r.mail.maintainAliens(locals(null));assert.equal(sent.length,1);assert.equal(sent[0].body.to[0],buyer+'@example.test');assert(!JSON.stringify(sent).includes('An unread update'));checks+=3;
 await r.mail.maintainAliens(locals(null));assert.equal(sent.length,1);checks++;
 const token=await r.mail.alienEmailToken(env.SIGMA_TOKEN_SECRET,actors[buyer].profileId,randomUUID());assert(await r.mail.verifyAlienEmailToken(env.SIGMA_TOKEN_SECRET,token));assert.equal(await r.mail.verifyAlienEmailToken(env.SIGMA_TOKEN_SECRET,token.slice(0,-1)+'z'),null);checks+=2;
 const beforePreference=await owner(`select token,digest_after from app.alien_preferences where profile_id=${quote(actors[buyer].profileId)}`);
 await ok(await post(buyer,{action:'email',enabled:false}));
 await ok(await post(buyer,{action:'email',enabled:true}));
 const afterPreference=await owner(`select token,digest_after from app.alien_preferences where profile_id=${quote(actors[buyer].profileId)}`);assert.notEqual(beforePreference[0].token,afterPreference[0].token);assert(afterPreference[0].digest_after>=beforePreference[0].digest_after);checks+=2;
 await ok(await post(buyer,{action:'email',enabled:false}));
 const listingReport=await ok(await post(buyer,{action:'report',listing:id,message:null,reason:'Listing moderation test'}));
 await ok(await post(admin,{action:'moderate',report:listingReport.id,operation:'hide'}));
 await expectStatus(getItem(null,id),404);await expectStatus(getItem(seller,id),200);await expectStatus(save(seller,id,item.version+1,'renew'),403);
 await expectStatus(call('photo',null,undefined,{params:{id,file:d.photos[0]+'.jpg'}}),404);
 await ok(await post(admin,{action:'moderate',report:listingReport.id,operation:'restore'}));await expectStatus(getItem(null,id),200);
 item=await ok(await getItem(seller,id));item=await ok(await save(seller,id,item.version,'sold'));
 await ok(await post(admin,{action:'moderate',report:listingReport.id,operation:'hide'}));await ok(await post(admin,{action:'moderate',report:listingReport.id,operation:'restore'}));assert.equal((await ok(await getItem(null,id))).status,'sold');checks++;
 // A full page with identical timestamps must not skip older messages.
 await owner(`insert into app.alien_messages(id,thread_id,sender_id,body,created_at) select gen_random_uuid(),${quote(message.thread_id)},${quote(actors[seller].profileId)},'History '||n,now()-interval '2 days' from generate_series(1,105) n returning id`);
 const recent=await ok(await call('member',buyer,undefined,{path:'/api/aliens-list/member?thread='+message.thread_id}));assert.equal(recent.messages.length,100);const first=recent.messages[0];
 const earlier=await ok(await call('member',buyer,undefined,{path:'/api/aliens-list/member?thread='+message.thread_id+'&before='+encodeURIComponent(first.created_at)+'&before_id='+first.id}));
 const count=await owner(`select count(*)::int n from app.alien_messages where thread_id=${quote(message.thread_id)}`);assert.equal(new Set([...recent.messages,...earlier.messages].map(m=>m.id)).size,count[0].n);checks+=2;
 await expectStatus(call('member',buyer,undefined,{path:'/api/aliens-list/member?thread='+message.thread_id+'&before='+encodeURIComponent(first.created_at)}),400);
 // Member tools remain bounded after years of drafts; fixtures stay in this database.
 await owner(`insert into app.alien_listings(id,owner_id,document) select gen_random_uuid(),${quote(actors[other].profileId)},${quote(JSON.stringify(draft({kind:'wanted',photos:[]})))}::jsonb from generate_series(1,30) returning id`);
 const firstMine=await ok(await call('member',other)),nextMine=await ok(await call('member',other,undefined,{path:'/api/aliens-list/member?page=1'}));assert.equal(firstMine.listings.length,25);assert.equal(firstMine.listings_total,31);assert.equal(new Set([...firstMine.listings,...nextMine.listings].map(l=>l.id)).size,31);checks+=3;
 console.log(`OK: ${checks} Aliens List behavioral and isolation assertions; private drafts/messages, real photo upload, publication, location rounding, expiry/renewal, search alerts, block/report/moderation and mocked email. No production data or external mail used.`);
}finally{
 globalThis.fetch=originalFetch;await owner(`delete from app.profiles where clerk_user_id in (${names.map(quote).join(',')}) returning id`);await rm(bundle,{force:true});delete globalThis.__alienTestBucket;
}

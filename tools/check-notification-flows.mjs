import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {build} from 'esbuild';
import {resolve,join} from 'node:path';
import {rm} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {queryDatabase as db} from './lib/connection-test-db.mjs';
const root=resolve(import.meta.dirname,'..'), bundle=join(root,'node_modules',`.notification-flow-${process.pid}.mjs`);
await build({stdin:{resolveDir:root,contents:`export * from './src/pages/api/notifications/index';`},outfile:bundle,bundle:true,platform:'node',format:'esm',packages:'external',logLevel:'silent',plugins:[{name:'local-db',setup(b){b.onResolve({filter:/^(?:@\/lib\/db|\.\/db)$/},()=>({path:join(root,'tools/lib/connection-test-db.mjs')}));}}]});
const route=await import(pathToFileURL(bundle).href), origin='https://notifications.test';
const locals=user=>({__testActor:{actorKind:user?'clerk':'public',clerkUserId:user},auth:()=>({userId:user})});
async function get(user,query=''){const url=new URL('/api/notifications'+query,origin);return route.GET({locals:locals(user),url,request:new Request(url)});}
async function post(user,ids,source=origin){const url=new URL('/api/notifications',origin);return route.POST({locals:locals(user),url,request:new Request(url,{method:'POST',headers:{origin:source,'content-type':'application/json'},body:JSON.stringify({ids})})});}
const owner=async sql=>db(sql,null,true);
try {
 const users=['notice_alice','notice_bob','notice_carla'];const ids=[];
 for(const user of users){const rows=await db(`select app.ensure_profile('${user}','${user}','Notification test',null) as id`,{actorKind:'clerk',clerkUserId:user});ids.push(rows[0].id);}
 const [a,b,c]=ids, [alice,bob,carla]=users, actor={actorKind:'clerk',clerkUserId:alice,profileId:a};
 const org=(await db(`select app.create_organization('${a}','notice-team','company','Notice team',null,null,null,null,null,'[]'::jsonb) as id`,actor))[0].id;
 await owner(`insert into app.organization_members(organization_id,profile_id,role) values('${org}','${b}','member'),('${org}','${c}','admin') returning profile_id`);
 assert.equal((await get(null)).status,401);assert.equal((await get(alice,'?filter=wrong')).status,400);
 const inquiry=randomUUID(), key=randomUUID(), subject=randomUUID();
 const insert=`insert into app.robot_inquiries(id,subject_id,organization_id,sender_id,creation_key,product_name,topic,message,reply_email) values('${inquiry}','${subject}','${org}','${b}','${key}','Test robot','technical','Documented interface question','visitor@example.test') on conflict(sender_id,creation_key) do nothing returning id`;
 await owner(insert);await owner(insert);
 let feed=await (await get(carla,'?filter=action')).json();assert.equal(feed.items.filter(n=>n.event_type==='product.inquiry').length,1);assert.equal(feed.needs_action,1);assert(feed.items[0].href.includes('inquiry='+inquiry));
 const notice=feed.items[0].id;
 assert.equal((await post(carla,[notice],'https://other.test')).status,403);
 assert.equal((await (await post(bob,[notice])).json()).marked.length,0);
 await post(carla,[notice]);feed=await (await get(carla,'?filter=action')).json();assert(feed.items.find(n=>n.id===notice).read_at);assert.equal(feed.needs_action,1,'read does not resolve work');
 await owner(`update app.robot_inquiries set status='replied' where id='${inquiry}' returning id`);
 assert.equal((await (await get(carla,'?filter=action')).json()).needs_action,0);
 await owner(`update app.organization_members set role='member' where organization_id='${org}' and profile_id='${c}' returning profile_id`);
 assert(!(await (await get(carla,'?filter=all')).json()).items.some(n=>n.id===notice),'demotion removes private inquiry notification');
 const room=randomUUID(), doc=JSON.stringify({title:'Test workroom',kind:'model',goal:'Review model evidence',acceptance:'Check the evidence',next_action:'Read the result',source_url:'',source_revision:''});
 await owner(`insert into app.workrooms(id,owner_profile_id,organization_id,creation_key,creation_document,document) values('${room}','${a}','${org}','${randomUUID()}','${doc}','${doc}') returning id`);
 await owner(`update app.workrooms set status='review',version=version+1 where id='${room}' returning id`);
 feed=await (await get(bob,'?filter=action')).json();assert(feed.items.some(n=>n.event_type==='workroom.review'));
 await owner(`delete from app.organization_members where organization_id='${org}' and profile_id='${b}' returning profile_id`);
 feed=await (await get(bob,'?filter=all')).json();assert(!feed.items.some(n=>n.event_type.startsWith('workroom.')||n.event_type==='organization.membership'));
 await owner(`update app.workrooms set status='archived',version=version+1 where id='${room}' returning id`);
 assert.equal((await (await get(alice,'?filter=action')).json()).needs_action,0);
 await assert.rejects(()=>db(`select app.enqueue_member_notification('${a}','forged','fake','Forged','Fake','/account')`,{actorKind:'clerk',clerkUserId:bob,profileId:b}));
 for(let i=0;i<37;i++)await owner(`select app.enqueue_member_notification('${b}','pagination-${i}','test.history','Update ${i}','Test body','/account')`);
 await owner(`select app.enqueue_member_notification('${b}','pagination-0','test.history','Duplicate','Test body','/account')`);
 feed=await (await get(bob,'?filter=unread')).json();assert.equal(feed.unread,37);assert.equal(feed.items.length,30);assert(feed.next);
 const next=await (await get(bob,'?filter=unread&'+new URLSearchParams(feed.next))).json();assert.equal(next.items.length,7);assert.equal(new Set([...feed.items,...next.items].map(n=>n.id)).size,37);
 assert.equal((await (await get(bob,'?summary=1')).json()).unread,37,'opening and polling never mark read');
 const response=await post(bob,feed.items.map(n=>n.id));assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal((await (await get(bob)).json()).unread,7);
 console.log('Notifications passed: real authenticated routes and restricted RLS; inquiry retry dedupe, explicit read vs action state, membership revocation/demotion, Workroom results, helper forgery denial, 37-event cursor pagination and durable unread counts.');
} finally {await rm(bundle,{force:true});}

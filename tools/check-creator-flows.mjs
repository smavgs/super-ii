import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { rm } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { queryDatabase } from './lib/connection-test-db.mjs';

const root=resolve(import.meta.dirname,'..');
const bundle=join(root,'node_modules',`.creator-flow-${process.pid}.mjs`);
const definitions={create:'src/pages/api/repositories/index.ts',presentation:'src/pages/api/repositories/[repositoryId]/presentation.ts',files:'src/pages/api/repositories/[repositoryId]/files/[fileId].ts'};
await build({stdin:{contents:Object.entries(definitions).map(([key,file])=>`export * as ${key} from ${JSON.stringify(resolve(root,file))};`).join('\n'),resolveDir:root},outfile:bundle,bundle:true,platform:'node',format:'esm',packages:'external',tsconfig:join(root,'tsconfig.json'),logLevel:'silent',plugins:[{name:'isolated-creator-fixtures',setup(b){
  b.onResolve({filter:/^(?:@\/lib\/db|\.\/db)$/},()=>({path:join(root,'tools/lib/connection-test-db.mjs')}));
  b.onResolve({filter:/^(?:@\/lib\/runtime|\.\/runtime)$/},()=>({path:'fixture-runtime',namespace:'fixture'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export async function runtimeFetch(){return new Response("fixture bytes");} export function proxiedFileResponse(response){return response;}'}));
}}]});
const routes=await import(pathToFileURL(bundle).href);
const alice='creator_flow_alice',bob='creator_flow_bob';
const locals=user=>({__testActor:user?{actorKind:'clerk',clerkUserId:user}:{actorKind:'public'},auth:()=>({userId:user??null}),currentUser:async()=>user?{id:user,username:user,firstName:'Creator',lastName:'Test',emailAddresses:[],primaryEmailAddressId:null,imageUrl:null}:null});
// A real same-origin browser GET does not contain Origin. Keep that distinction
// in the API fixtures so draft preflight and private image reads are exercised.
const request=(method,body,path='/api/repositories',headers=method==='GET'?{'sec-fetch-site':'same-origin'}:{origin:'http://localhost','content-type':'application/json'})=>new Request(`http://localhost${path}`,{method,headers,...(method==='GET'?{}:{body:JSON.stringify(body)})});
let repositoryId;
try {
  const created=await routes.create.POST({locals:locals(alice),request:request('POST',{kind:'model',slug:'creator-fixture',title:'Initial page',summary:''})});
  assert.equal(created.status,201,await created.clone().text());
  const data=await created.json();repositoryId=data.repository_id;
  const params={repositoryId};const path=`/api/repositories/${repositoryId}/presentation`;
  const card='# Updated page\n\nA real README.\n';const sha=createHash('sha256').update(card).digest('hex');
  const body={revision_id:data.revision_id,version:0,title:'Updated page',summary:'More detail',card_markdown:card};
  async function save(user,payload=body){return routes.presentation.POST({locals:locals(user),params,request:request('POST',payload,path)});}
  const version=(user,headers)=>routes.presentation.GET({locals:locals(user),params,request:request('GET',null,path,headers)});
  assert.equal((await version(null)).status,401);
  assert.equal((await version(bob)).status,404);
  assert.deepEqual(await (await version(alice)).json(),{revision_id:data.revision_id,version:0,editable:true});
  assert.equal((await version(alice,{referer:'http://localhost/repositories/example/edit'})).status,200);
  assert.equal((await version(alice,{origin:'http://localhost'})).status,200);
  for(const headers of [{},{'sec-fetch-site':'cross-site'},{'sec-fetch-site':'same-site'},
    {referer:'https://attacker.invalid/'},{referer:'invalid'},
    {'sec-fetch-site':'cross-site',referer:'http://localhost/'},
    {'sec-fetch-site':'same-origin',origin:'https://attacker.invalid'}]) {
    assert.equal((await version(alice,headers)).status,403,'untrusted reads must stay closed');
  }
  assert.equal((await routes.presentation.POST({locals:locals(alice),params,
    request:request('POST',body,path,{'sec-fetch-site':'same-origin','content-type':'application/json'})})).status,403,
    'write requests still require the exact Origin header');
  assert.equal((await save(null)).status,401);
  assert.equal((await save(bob)).status,404);
  assert.equal((await save(alice)).status,409,'unscanned README must not become the public card');
  const rows=await queryDatabase(`insert into app.repository_files(repository_id,revision_id,path,size_bytes,mime_type,sha256,storage_key,storage_state,scan_status,created_by) values ('${repositoryId}','${data.revision_id}','README.md',${Buffer.byteLength(card)},'text/markdown','${sha}','objects/${sha}','available','clean','creator-test') returning id`,null,true);
  const saved=await save(alice);assert.equal(saved.status,200,await saved.clone().text());assert.equal((await saved.json()).version,1);
  assert.equal((await (await version(alice)).json()).version,1);
  assert.equal((await save(alice)).status,409,'stale editor must not overwrite newer presentation');
  assert.equal((await save(alice,{...body,version:1,revision_id:'00000000-0000-4000-8000-000000000099'})).status,409);
  const original=await queryDatabase(`select title from app.repositories where id='${repositoryId}'`,null,true);
  assert.equal(original[0].title,'Initial page','draft title leaked into public metadata');
  const fileId=rows[0].id;const filePath=`/api/repositories/${repositoryId}/files/${fileId}?draft=1&branch=${data.branch_id}`;
  const getFile=(user,headers)=>routes.files.GET({locals:locals(user),params:{repositoryId,fileId},request:request('GET',null,filePath,headers)});
  assert.equal((await getFile(alice)).status,200);
  assert.equal((await getFile(alice,{'sec-fetch-site':'same-origin','sec-fetch-dest':'image'})).status,200);
  assert.equal((await getFile(alice,{referer:'http://localhost/repositories/example/edit'})).status,200);
  assert.equal((await getFile(alice,{'sec-fetch-site':'cross-site','sec-fetch-dest':'image'})).status,404);
  assert.equal((await getFile(alice,{'sec-fetch-site':'same-origin',origin:'https://attacker.invalid'})).status,404);
  assert.equal((await getFile(bob)).status,404);
  assert.equal((await getFile(null)).status,404);
  assert.equal((await routes.files.GET({locals:locals(null),params:{repositoryId,fileId},request:request('GET',null,filePath.replace('draft=1&',''))})).status,404);
  const removed=await routes.files.DELETE({locals:locals(alice),params:{repositoryId,fileId},request:request('DELETE',{},filePath)});
  assert.equal(removed.status,200,await removed.clone().text());
  const cleared=await queryDatabase(`select presentation from app.repository_revisions where id='${data.revision_id}'`,null,true);
  assert.equal(cleared[0].presentation.card_markdown,'');
  assert.equal(cleared[0].presentation.readme_sha256,undefined);
  console.log('OK: fresh personal creator, browser Origin-free reads, cross-origin/write rejection, scanned README binding, stale/wrong revision rejection, draft metadata isolation, private preview authorization');
} finally {
  if(repositoryId)await queryDatabase(`delete from app.repositories where id='${repositoryId}' returning id`,null,true);
  await queryDatabase(`delete from app.profiles where clerk_user_id in ('${alice}','${bob}') returning id`,null,true);
  await rm(bundle,{force:true});
}

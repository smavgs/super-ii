import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { resolve, join } from "node:path";
import { rm, readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { queryDatabase as db } from "./lib/connection-test-db.mjs";
const root = resolve(import.meta.dirname, "..");
const bundle = join(root, "node_modules", `.robot-explorer-${process.pid}.mjs`);
const definitions = {
 explore:"src/pages/api/robots/explore.ts",company:"src/pages/api/robots/company.ts",publication:"src/pages/api/robots/publication.ts",
 products:"src/lib/products.ts",draft:"src/pages/api/products/[productId].ts",robot:"src/pages/api/robot/robots/index.ts",qr:"src/pages/api/robots/qr.svg.ts"
};
await build({
  stdin: {
    contents: Object.entries(definitions)
      .map(
        ([key, file]) =>
          `export * as ${key} from ${JSON.stringify(resolve(root, file))};`,
      )
      .join("\n"),
    resolveDir: root,
  },
  outfile: bundle,
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  tsconfig: join(root, "tsconfig.json"),
  logLevel: "silent",
  plugins: [
    {
      name: "isolated-product-fixtures",
      setup(b) {
        b.onResolve({ filter: /^(?:@\/lib\/db|\.\/db)$/ }, () => ({
          path: join(root, "tools/lib/connection-test-db.mjs"),
        }));
        b.onResolve({ filter: /^agents\/mcp\/server$/ }, () => ({
          path: "mcp-transport",
          namespace: "fixture",
        }));
        b.onResolve({ filter: /\?raw$/ }, (args) => ({
          path: args.path.startsWith("@/")
            ? resolve(root, "src", args.path.slice(2, -4))
            : resolve(args.resolveDir, args.path.slice(0, -4)),
          namespace: "raw",
        }));
        b.onLoad({ filter: /.*/, namespace: "raw" }, async (args) => ({
          contents: await readFile(args.path, "utf8"),
          loader: "text",
        }));
        b.onResolve({ filter: /^cloudflare:workers$/ }, () => ({
          path: "cloudflare",
          namespace: "fixture",
        }));
        b.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
          resolveDir: root,
          contents:
            args.path === "cloudflare"
              ? `const objects=new Map();export const env={SHOWCASE_MEDIA:{async put(key,bytes){objects.set(key,bytes);},async get(key){const bytes=objects.get(key);return bytes?{body:new Response(bytes).body}:null;},async delete(key){objects.delete(key);}}};export function waitUntil(){}`
              : `import {WebStandardStreamableHTTPServerTransport} from '@modelcontextprotocol/server';export function createMcpHandler(createServer){return {async fetch(request){const server=createServer();const transport=new WebStandardStreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});await server.connect(transport);return transport.handleRequest(request);}}}`,
        }));
      },
    },
  ],
});
const r=await import(pathToFileURL(bundle).href);
const actors=['robot_explorer_alice','robot_explorer_bob'];
const actor=user=>({actorKind:'clerk',clerkUserId:user});
const locals=user=>({__testActor:user?actor(user):{actorKind:'public'},auth:()=>({userId:user??null}),currentUser:async()=>user?{id:user,username:user,firstName:'Local',lastName:'Fixture',emailAddresses:[],primaryEmailAddressId:null,imageUrl:null}:null});
const context=(user,body,path='/api/robots/company',method='POST')=>{const request=new Request('http://localhost'+path,{method,headers:method==='GET'?{'sec-fetch-site':'same-origin'}:{origin:'http://localhost','content-type':'application/json'},...(method==='GET'?{}:{body:JSON.stringify(body)})});return{locals:locals(user),request,url:new URL(request.url),params:{}};};
let checks=0;
const ok=async(response)=>{assert(response.ok,`${response.status}: ${await response.clone().text()}`);checks++;return response.json();};
const ref='ce0d6387-a410-4c45-b345-02d85bf35ed8',product='7db14f2d-e355-4d4c-aef2-1c8495fc6c57';
const quote=v=>"'"+String(v).replaceAll("'","''")+"'";
const docs=v=>quote(JSON.stringify(v))+'::jsonb';
try{
 const search=await ok(await r.explore.GET(context(null,null,'/api/robots/explore?category=robot','GET')));
 assert(search.items.length===6&&search.total>100);checks++;
 const page=await ok(await r.explore.GET(context(null,null,'/api/robots/explore?category=robot&offset=6','GET')));assert(!page.items.some(i=>search.items.some(j=>i.id===j.id)));checks++;
 const detail=await ok(await r.explore.GET(context(null,null,`/api/robots/explore?id=${product}`,'GET')));assert.equal(detail.source,'reference');assert(!('seed' in detail));checks++;
 assert.equal((await r.explore.GET(context(null,null,'/api/robots/explore?offset=-1','GET'))).status,422);checks++;
 const req={action:'request',reference_id:ref,organization_id:null,handle:'robot-explorer-fixture',notes:'Local test representative authority evidence',evidence_url:'https://www.unitree.com/',authorized:true};
 assert.equal((await r.company.POST(context(null,req))).status,401);checks++;
 const first=(await ok(await r.company.POST(context(actors[0],req)))).result;
 const retry=(await ok(await r.company.POST(context(actors[0],req)))).result;assert.equal(first.id,retry.id);assert.equal(first.organization_id,retry.organization_id);checks++;
 const org=first.organization_id;
 const profiles=await db(`select id,clerk_user_id from app.profiles where clerk_user_id=${quote(actors[0])}`,null,true);const profile=profiles[0].id;
 assert.equal((await db(`select is_public from app.organizations where id='${org}'`,null,true))[0].is_public,false);checks++;
 const prepare={action:'prepare',reference_id:product,company_id:ref,organization_id:org};
 assert.equal((await r.company.POST(context(actors[1],prepare))).status,403);checks++;
 const saved=(await ok(await r.company.POST(context(actors[0],prepare)))).result.product_id;
 assert.equal((await ok(await r.company.POST(context(actors[0],prepare)))).result.product_id,saved);checks++;
 let draft=(await db(`select app.company_product_draft('${saved}') as d`,actor(actors[0])))[0].d;
 assert(draft.product.specs.length>0);assert(r.products.productDocumentSchema.safeParse(draft.product).success);checks++;
 assert.equal((await db(`select app.company_product_draft('${saved}') as d`,actor(actors[1])))[0].d,null);checks++;
 await assert.rejects(db(`select app.publish_company_product('${saved}',${draft.version},${draft.company_version},true)`,actor(actors[0])));checks++;
 assert.equal((await r.company.POST(context(actors[1],{action:'confirm',request_id:first.id,authorized:true}))).status,403);checks++;
 assert.equal((await r.company.POST(context(actors[0],{action:'confirm',request_id:first.id,authorized:true}))).status,403);checks++;
 await db(`select app.start_company_website_check('${org}','www.unitree.com') as result`,actor(actors[0]));
 // DNS lookup is a separate integration; fixture establishes its documented checked result locally.
 await db(`update app.company_website_checks set checked_at=now() where organization_id='${org}' returning organization_id`,null,true);
 await db(`update app.robot_claim_requests set status='declined',review_note='Local test declined evidence' where id='${first.id}' returning id`,null,true);
 assert.equal((await r.company.POST(context(actors[0],{action:'confirm',request_id:first.id,authorized:true}))).status,403);checks++;
 const resubmit=(await ok(await r.company.POST(context(actors[0],req)))).result;assert.equal(resubmit.status,'pending');assert.equal(resubmit.id,first.id);checks++;
 await ok(await r.company.POST(context(actors[0],{action:'confirm',request_id:first.id,authorized:true})));
 await ok(await r.company.POST(context(actors[0],{action:'confirm',request_id:first.id,authorized:true})));
 const access=(await ok(await r.company.POST(context(actors[1],{...req,handle:'not-created'})))).result;assert.equal(access.kind,'access');assert.equal(access.organization_id,org);checks++;
 assert.equal((await r.company.POST(context(actors[1],{action:'review',request_id:access.id,approve:true,reason:'Self approval must not be possible'}))).status,403);checks++;
 await ok(await r.company.POST(context(actors[0],{action:'review',request_id:access.id,approve:true,reason:'Verified local fixture team member'})));
 assert.equal((await db(`select (app.robot_company_workspace('${ref}')->>'can_manage')::boolean as ok`,actor(actors[1])))[0].ok,true);checks++;
 const bob=(await db(`select id from app.profiles where clerk_user_id=${quote(actors[1])}`,null,true))[0].id;
 const workspace=(await db(`select app.robot_company_workspace('${ref}') as result`,actor(actors[0])))[0].result;
 assert.equal(workspace.can_manage_team,true);assert(workspace.members.some(member=>member.id===bob&&member.role==='admin'));checks++;
 assert.equal((await r.company.POST(context(actors[1],{action:'remove-member',reference_id:ref,profile_id:profile}))).status,403);checks++;
 assert.equal((await ok(await r.company.POST(context(actors[0],{action:'remove-member',reference_id:ref,profile_id:profile})))).result,false);checks++;
 await ok(await r.company.POST(context(actors[0],{action:'remove-member',reference_id:ref,profile_id:bob})));
 assert.equal((await db(`select (app.robot_company_workspace('${ref}')->>'can_manage')::boolean as ok`,actor(actors[1])))[0].ok,false);checks++;
 assert.equal((await r.company.POST(context(actors[1],prepare))).status,403);checks++;
 const reaccess=(await ok(await r.company.POST(context(actors[1],req)))).result;assert.equal(reaccess.id,access.id);assert.equal(reaccess.kind,'access');assert.equal(reaccess.status,'pending');checks++;
 const privateWorkspace=(await db(`select app.robot_company_workspace('${ref}') as result`,actor(actors[1])))[0].result;assert.equal(privateWorkspace.members.length,0);assert.equal(privateWorkspace.inbox.length,0);checks++;
 const company={...draft.company,email:'public@example.com'};
 await db(`select app.save_company_product('${saved}',${draft.version},${draft.company_version},${docs(company)},${docs(draft.product)})`,actor(actors[0]));
 draft=(await db(`select app.company_product_draft('${saved}') as d`,actor(actors[0])))[0].d;
 await db(`select app.publish_company_product('${saved}',${draft.version},${draft.company_version},true)`,actor(actors[0]));
 const published=await ok(await r.explore.GET(context(null,null,`/api/robots/explore?id=${product}`,'GET')));assert.equal(published.source,'company');assert.equal(published.id,product);assert.equal(published.maintained.product.name,draft.product.name);checks++;
 draft=(await db(`select app.company_product_draft('${saved}') as d`,actor(actors[0])))[0].d;
 await db(`select app.pause_company_product('${saved}',${draft.version})`,actor(actors[0]));
 assert.equal((await r.explore.GET(context(null,null,`/api/robots/explore?id=${product}`,'GET'))).status,404);checks++;
 // A newly saved community plan must remain undiscoverable until the owner explicitly publishes it.
 const robot=(await db(`select * from app.create_robot_with_version('${profile}',null,'robot-explorer-${randomUUID().slice(0,8)}','Local Robot','Local private draft','Builders','public','{}'::jsonb,'{"catalog_revision":"test","robot_check":[]}'::jsonb,'test','Initial draft',null)`,actor(actors[0])))[0].robot_id;
 assert.equal((await r.explore.GET(context(null,null,`/api/robots/explore?id=${robot}`,'GET'))).status,404);checks++;
 assert.equal((await r.publication.POST(context(actors[1],{robot_id:robot,publish:true,stage:'concept'}))).status,403);checks++;
 await ok(await r.publication.POST(context(actors[0],{robot_id:robot,publish:true,stage:'concept'})));
 assert.equal((await ok(await r.explore.GET(context(null,null,`/api/robots/explore?id=${robot}`,'GET')))).source,'community');checks++;
 await ok(await r.publication.POST(context(actors[0],{robot_id:robot,publish:false,stage:'concept'})));
 assert.equal((await r.explore.GET(context(null,null,`/api/robots/explore?id=${robot}`,'GET'))).status,404);checks++;
 // All imported records must remain valid editable documents; do not silently truncate schemas.
 const invalid=await db("select count(*)::int as n from app.robot_reference_records where not(case when record_type='product' then app.product_document_valid(document->'seed') else app.company_document_valid(document->'seed') end)",null,true);assert.equal(invalid[0].n,0);checks++;
 const full=(await db("select max(jsonb_array_length(document->'seed'->'specs'))::int as n from app.robot_reference_records where record_type='product'",null,true))[0].n;assert.equal(full,212);checks++;
 console.log(`Robots explorer passed: ${checks} HTTP/database checks; claim retries, authority denial and proof, owner-approved access, full imported specs, preserved links, pause, and explicit community publication.`);
 }finally{
 const people="select id from app.profiles where clerk_user_id in ('robot_explorer_alice','robot_explorer_bob')";
 const owned=await db(`select distinct organization_id as id from app.robot_claim_requests where requester_id in (${people})`,null,true);
 const ids=owned.map(row=>quote(row.id)).join(',');
 if(ids){
  for(const table of ['robot_reference_links','robot_company_claims','robot_claim_requests'])await db(`delete from app.${table} where organization_id in (${ids}) returning organization_id`,null,true);
 }
 if(ids)await db(`delete from app.organizations where id in (${ids}) returning id`,null,true);
 // Immutable local Robot versions and their fixture authors disappear with the disposable container.
 await rm(bundle,{force:true});
}

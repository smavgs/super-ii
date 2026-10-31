import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { resolve, join } from "node:path";
import { rm, readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { queryDatabase as db } from "./lib/connection-test-db.mjs";
const root = resolve(import.meta.dirname, "..");
const bundle = join(root, "node_modules", `.robot-experience-${process.pid}.mjs`);
const definitions = {
 engagement:"src/pages/api/robots/engagement.ts", inquiries:"src/pages/api/robots/inquiries.ts",
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
const runKey=randomUUID().slice(0,8);
const actors=['experience_owner_'+runKey,'experience_visitor_'+runKey,'experience_other_'+runKey];
const actor=user=>({actorKind:'clerk',clerkUserId:user});
const locals=user=>({__testActor:user?actor(user):{actorKind:'public'},auth:()=>({userId:user??null}),currentUser:async()=>user?{id:user,username:user,firstName:'Local',lastName:'Fixture',emailAddresses:[],primaryEmailAddressId:null,imageUrl:null}:null});
const context=(user,body,path='/api/robots/company',method='POST')=>{const request=new Request('http://localhost'+path,{method,headers:method==='GET'?{'sec-fetch-site':'same-origin'}:{origin:'http://localhost','content-type':'application/json'},...(method==='GET'?{}:{body:JSON.stringify(body)})});return{locals:locals(user),request,url:new URL(request.url),params:{}};};
let checks=0;
const ok=async(response)=>{assert(response.ok,`${response.status}: ${await response.clone().text()}`);checks++;return response.json();};
const status=async(response,expected)=>{assert.equal(response.status,expected,await response.clone().text());checks++;};
const ref='ce0d6387-a410-4c45-b345-02d85bf35ed8',product='7db14f2d-e355-4d4c-aef2-1c8495fc6c57';
const quote=v=>"'"+String(v).replaceAll("'","''")+"'";
const docs=v=>quote(JSON.stringify(v))+'::jsonb';
let org;
try{
 const other=(await db(`select id from app.robot_reference_records where record_type='product' and document->'company_ids' ? '${ref}' and id<>'${product}' order by id limit 1`,null,true))[0].id;
 await status(await r.engagement.POST(context(null,{id:product,action:'like',liked:true},'/api/robots/engagement')),401);
 const cross=context(null,{id:product,action:'view'},'/api/robots/engagement');cross.request.headers.set('origin','https://elsewhere.example');await status(await r.engagement.POST(cross),403);
 const hash=randomUUID().replaceAll('-','').repeat(2);const before=(await db(`select app.robot_engagement('${product}','read') as m`))[0].m;
 const firstView=(await db(`select app.robot_engagement('${product}','view','${hash}') as m`))[0].m;
 const repeatView=(await db(`select app.robot_engagement('${product}','view','${hash}') as m`))[0].m;
 assert.equal(firstView.views,before.views+1);assert.equal(firstView.views,repeatView.views);checks+=2;
 await ok(await r.engagement.POST(context(actors[1],{id:product,action:'like',liked:true},'/api/robots/engagement')));
 const like=await ok(await r.engagement.POST(context(actors[1],{id:product,action:'like',liked:true},'/api/robots/engagement')));assert.equal(like.likes,1);assert(like.liked);checks+=2;
 const unlike=await ok(await r.engagement.POST(context(actors[1],{id:product,action:'like',liked:false},'/api/robots/engagement')));assert.equal(unlike.likes,0);checks++;
 const req={action:'request',reference_id:ref,product_id:product,organization_id:null,handle:'product-claim-'+runKey,notes:'A company representative requesting only the named product.',evidence_url:'https://www.unitree.com/',authorized:true};
 const claim=(await ok(await r.company.POST(context(actors[0],req)))).result;org=claim.organization_id;
 assert.equal((await ok(await r.company.POST(context(actors[0],req)))).result.id,claim.id);checks++;
 const prepare={action:'prepare',reference_id:product,company_id:ref,organization_id:org};
 await status(await r.company.POST(context(actors[0],{...prepare,reference_id:other})),403);
 const saved=(await ok(await r.company.POST(context(actors[0],prepare)))).result.product_id;
 let draft=(await db(`select app.company_product_draft('${saved}') as d`,actor(actors[0])))[0].d;
 await assert.rejects(db(`select app.publish_company_product('${saved}',${draft.version},${draft.company_version},true)`,actor(actors[0])));checks++;
 await status(await r.company.POST(context(actors[0],{action:'confirm',request_id:claim.id,authorized:true})),403);
 await db(`select app.start_company_website_check('${org}','www.unitree.com') as result`,actor(actors[0]));
 await db(`update app.company_website_checks set checked_at=now() where organization_id='${org}' returning organization_id`,null,true);
 await ok(await r.company.POST(context(actors[0],{action:'confirm',request_id:claim.id,authorized:true})));
 assert.equal((await db(`select count(*)::int as n from app.robot_company_claims where organization_id='${org}'`,null,true))[0].n,0);checks++;
 assert.equal((await db(`select count(*)::int as n from app.robot_product_claims where organization_id='${org}'`,null,true))[0].n,1);checks++;
 await status(await r.company.POST(context(actors[0],{...prepare,reference_id:other})),403);
 const workspace=(await db(`select app.robot_claim_workspace('${ref}','${product}') as d`,actor(actors[0])))[0].d;assert.equal(workspace.products.length,1);assert(workspace.can_manage);checks+=2;
 assert.equal((await db(`select app.robot_company_workspace('${ref}') as d`,actor(actors[0])))[0].d.can_manage,false);checks++;
 const contact={action:'contact',reference_id:ref,product_id:product,email:'robot-inquiries@example.com',wechat:'example-team',authorized:true};
 await status(await r.company.POST(context(actors[1],contact)),403);
 // Contact publishing cannot leak an unrelated private draft change.
 await db(`update app.company_pages set draft=jsonb_set(draft,'{summary}','"Private business note"'::jsonb) where organization_id='${org}' returning organization_id`,null,true);
 await ok(await r.company.POST(context(actors[0],contact)));
 const page=(await db(`select draft,published from app.company_pages where organization_id='${org}'`,null,true))[0];assert.equal(page.draft.summary,'Private business note');assert.notEqual(page.published.summary,'Private business note');checks+=2;
 assert.equal((await db(`select app.robot_contact('${product}') as c`))[0].c.email,contact.email);assert.equal((await db(`select app.robot_contact('${other}') as c`))[0].c,null);checks+=2;
 const inquiry={action:'send',id:product,creation_key:randomUUID(),topic:'technical',message:'Which documented interfaces does this exact model support?',reply_email:'visitor@example.com',consent:true};
 await status(await r.inquiries.POST(context(null,inquiry,'/api/robots/inquiries')),401);
 await status(await r.inquiries.POST(context(actors[1],{...inquiry,consent:false},'/api/robots/inquiries')),422);
 const receipt=await ok(await r.inquiries.POST(context(actors[1],inquiry,'/api/robots/inquiries')));
 assert.equal((await ok(await r.inquiries.POST(context(actors[1],inquiry,'/api/robots/inquiries')))).id,receipt.id);checks++;
 await status(await r.inquiries.POST(context(actors[1],{...inquiry,message:'Different message with same creation key must not duplicate.'},'/api/robots/inquiries')),409);
 await status(await r.inquiries.GET(context(actors[1],null,`/api/robots/inquiries?organization_id=${org}`,'GET')),403);
 const inbox=await ok(await r.inquiries.GET(context(actors[0],null,`/api/robots/inquiries?organization_id=${org}`,'GET')));assert.equal(inbox.total,1);assert.equal(inbox.items[0].reply_email,'visitor@example.com');checks+=2;
 await status(await r.inquiries.POST(context(actors[2],{action:'status',id:receipt.id,status:'replied'},'/api/robots/inquiries')),403);
 await ok(await r.inquiries.POST(context(actors[0],{action:'status',id:receipt.id,status:'replied'},'/api/robots/inquiries')));
 const publicResult=await ok(await r.explore.GET(context(null,null,`/api/robots/explore?id=${product}`,'GET')));assert(!JSON.stringify(publicResult).includes(inquiry.reply_email));assert(!JSON.stringify(publicResult).includes(inquiry.message));checks+=2;
 draft=(await db(`select app.company_product_draft('${saved}') as d`,actor(actors[0])))[0].d;
 await db(`select app.save_company_product('${saved}',${draft.version},${draft.company_version},${docs({...draft.company,country:'KR'})},${docs(draft.product)})`,actor(actors[0]));
 draft=(await db(`select app.company_product_draft('${saved}') as d`,actor(actors[0])))[0].d;
 await db(`select app.publish_company_product('${saved}',${draft.version},${draft.company_version},true)`,actor(actors[0]));
 const maintained=await ok(await r.explore.GET(context(null,null,`/api/robots/explore?id=${product}`,'GET')));assert.equal(maintained.source,'company');assert.equal(maintained.country,'KR');assert.equal(maintained.id,product);checks+=3;
 assert(r.products.companyDocumentSchema.safeParse({...draft.company,country:'KR'}).success);assert(!r.products.companyDocumentSchema.safeParse({...draft.company,country:'ZZ'}).success);checks+=2;
 const access=(await ok(await r.company.POST(context(actors[2],{...req,handle:'unused-'+runKey})))).result;
 await status(await r.company.POST(context(actors[2],{action:'review',request_id:access.id,approve:true,reason:'Attempt to grant access to myself'})),403);
 await ok(await r.company.POST(context(actors[0],{action:'review',request_id:access.id,approve:true,reason:'Verified product colleague for local test'})));
 await ok(await r.inquiries.GET(context(actors[2],null,`/api/robots/inquiries?organization_id=${org}`,'GET')));
 await status(await r.company.POST(context(actors[2],{...prepare,reference_id:other})),403);
 const member=(await db(`select id from app.profiles where clerk_user_id=${quote(actors[2])}`,null,true))[0].id;
 await ok(await r.company.POST(context(actors[0],{action:'remove-member',reference_id:ref,product_id:product,profile_id:member})));
 await status(await r.inquiries.GET(context(actors[2],null,`/api/robots/inquiries?organization_id=${org}`,'GET')),403);
 // A full-company owner must not grant company administration through a product-labelled request.
 const full=(await ok(await r.company.POST(context(actors[0],{...req,product_id:null,organization_id:org})))).result;
 await ok(await r.company.POST(context(actors[0],{action:'confirm',request_id:full.id,authorized:true})));
 await status(await r.company.POST(context(actors[1],{...req,product_id:other})),403);
 assert.equal((await db(`select app.robot_claim_workspace('${ref}','${other}') as d`,actor(actors[1])))[0].d.requires_company_access,true);checks++;
 const fullAccess=(await ok(await r.company.POST(context(actors[1],{...req,product_id:null})))).result;assert.equal(fullAccess.kind,'access');checks++;
 console.log(`Robots experience passed: ${checks} checks for scoped claims, contact privacy, original links, country selection, views, likes, consent, inquiry retries and team access.`);
}finally{
 if(org){for(const table of ['robot_reference_links','robot_product_claims','robot_company_claims','robot_claim_requests'])await db(`delete from app.${table} where organization_id='${org}' returning organization_id`,null,true);await db(`delete from app.organizations where id='${org}' returning id`,null,true);}
 await db(`delete from app.robot_likes where profile_id in(select id from app.profiles where clerk_user_id in(${actors.map(quote).join(',')})) returning subject_id`,null,true);
 await rm(bundle,{force:true});
}

import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
const {outputFiles}=await build({stdin:{contents:"export * from './src/lib/hf-catalogue';export * from './src/lib/hf-download';",resolveDir:process.cwd()},bundle:true,write:false,platform:'node',format:'esm'});
const hf=await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
const catalogue=JSON.parse(await readFile(new URL('../src/data/huggingface-catalog.json',import.meta.url),'utf8'));
assert.equal(catalogue.items.length,200);
assert.equal(catalogue.items.filter(i=>i.kind==='dataset').length,100);
assert.equal(new Set(catalogue.items.map(i=>i.id)).size,200);
for(const item of catalogue.items){assert.ok(hf.validHfRepo(item.repo_id));assert.ok(hf.validHfRevision(item.revision));assert.ok(hf.validHfId(item.id));if(item.kind==='space')assert.ok(hf.hfFrameOrigin(item.metadata.subdomain));}
for(const path of ['../secret','a/../b','a//b','/etc/passwd','a\\b','a%2f..','a\nheader','a/'.repeat(600)])assert.equal(hf.validHfPath(path),false);
assert.equal(hf.validHfPath('训练/episode 1.parquet'),true);
for(const subdomain of ['evil.example','a.hf.space/','https://a','-bad','a:80','a\n'])assert.equal(hf.hfFrameOrigin(subdomain),null);
assert.equal(hf.allowedHfDownloadUrl('https://cas-bridge.xethub.hf.co/file?x=1'),true);
assert.equal(hf.allowedHfDownloadUrl('https://us.aws.cdn.hf.co/file?x=1'),true);
for(const url of ['http://huggingface.co/file','https://huggingface.co.evil.test/file','https://user@huggingface.co/file','https://huggingface.co:81/file','https://127.0.0.1/file','https://evil.r2.cloudflarestorage.com/file'])assert.equal(hf.allowedHfDownloadUrl(url),false);
const item={kind:'dataset',provider_repo_id:'creator/data',source_revision:'a'.repeat(40)};
const file={type:'file',path:'data/file.parquet',size:16,oid:'b'.repeat(40),lfs:{oid:'c'.repeat(64)}};
let calls=[];
const metadata=async(url,options)=>{
  calls.push({url:String(url),options});assert.equal(options.redirect,'manual');assert.equal(options.headers.authorization,undefined);
  if(String(url).includes('/paths-info/')){assert.equal(options.method,'POST');assert.equal(options.body.get('paths'),file.path);return Response.json([file]);}
  if(String(url).includes('/tree/'))return Response.json([{type:'directory',path:'data',size:0,oid:'b'.repeat(40)}],{headers:{link:`<https://huggingface.co/api/datasets/creator/data/tree/${item.source_revision}?cursor=YWJjPQ==>; rel="next"`}});
  return Response.json({id:'creator/data',private:false,gated:false});
};
const list=await hf.hfFiles(item,'','',metadata);assert.equal(list.next,'YWJjPQ==');assert.equal(list.files[0].path,'data');assert.equal(calls.length,2);
const selected=await hf.hfFile(item,file.path,metadata);assert.equal(selected.sha256,'c'.repeat(64));
await assert.rejects(hf.hfPublicState(item,async()=>Response.json({id:'creator/data',private:false,gated:'auto'})),e=>e.status===403);
await assert.rejects(hf.hfPublicState(item,async()=>Response.json({id:'creator/data',private:true})),e=>e.status===404);
await assert.rejects(hf.hfPublicState(item,async()=>Response.json({id:'different/repo',private:false})),e=>e.status===404);
await assert.rejects(hf.hfFiles(item,'','bad!'),e=>e.status===400);
await assert.rejects(hf.hfJson(new Response('x'.repeat(1_048_577))),/too large/);
await assert.rejects(hf.hfFiles(item,'','',async(url,options)=>String(url).includes('/tree/')?Response.json([file],{headers:{link:'<https://evil.test/?cursor=abc>; rel="next"'}}):metadata(url,options)),/folder mismatch|pagination/);
await assert.rejects(hf.hfFile(item,'missing',async(url,options)=>String(url).includes('/paths-info/')?Response.json([]):metadata(url,options)),e=>e.status===404);
const payload=new TextEncoder().encode('0123456789abcdef');
let streamCalls=0;
const download=async(url,init)=>{
  streamCalls++;assert.equal(init.headers.get('authorization'),null);assert.equal(init.headers.get('cookie'),null);assert.equal(init.redirect,'manual');
  if(String(url).startsWith('https://huggingface.co/'))return new Response(null,{status:302,headers:{location:'https://cas-bridge.xethub.hf.co/file'}});
  const range=init.headers.get('range');const match=range?.match(/bytes=(\d+)-(\d+)/);const start=match?+match[1]:0,end=match?+match[2]:15;
  return new Response(init.method==='HEAD'?null:payload.slice(start,end+1),{status:range?206:200,headers:{'content-length':String(end-start+1),...(range?{'content-range':`bytes ${start}-${end}/16`}:{})}});
};
for(const [range,expected]of[['bytes=2-5','2345'],['bytes=-4','cdef'],['bytes=12-','cdef'],[null,'0123456789abcdef']]){
  const response=await hf.streamHfFile(new Request('https://superii.site/download',{headers:range?{range,cookie:'never-forward',authorization:'never-forward'}:{}}),item,selected,download);
  assert.equal(await response.text(),expected);assert.equal(response.status,range?206:200);assert.match(response.headers.get('content-disposition'),/attachment/);
}
const head=await hf.streamHfFile(new Request('https://superii.site/download',{method:'HEAD'}),item,selected,download);assert.equal(await head.text(),'');assert.equal(head.headers.get('content-length'),'16');
const before=streamCalls;
for(const range of ['bytes=90-100','bytes=1-2,4-5','bytes=-0','bad'])assert.equal((await hf.streamHfFile(new Request('https://superii.site/download',{headers:{range}}),item,selected,download)).status,416);
assert.equal(streamCalls,before);
await assert.rejects(hf.streamHfFile(new Request('https://superii.site/download'),item,selected,async()=>new Response(null,{status:302,headers:{location:'https://evil.test/file'}})),/Unsupported/);
await assert.rejects(hf.streamHfFile(new Request('https://superii.site/download',{headers:{range:'bytes=2-5'}}),item,selected,async()=>new Response('bad',{status:206,headers:{'content-range':'bytes 0-2/16'}})),/could not deliver/);
const stale=await hf.streamHfFile(new Request('https://superii.site/download',{headers:{range:'bytes=2-5','if-range':'"stale"'}}),item,selected,download);assert.equal(stale.status,200);assert.equal((await stale.text()).length,16);
console.log('OK: 200 source records; bounded metadata, source identity, gated/private access, exact-revision files, pagination, redirect allowlist, HEAD and range/resume downloads.');

import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),wranglerRequire=createRequire(require.resolve('wrangler/package.json'));
const {Miniflare,convertV4MiniflareOptions}=wranglerRequire('miniflare');
const {outputFiles}=await build({stdin:{resolveDir:process.cwd(),contents:`
import {resolveOllamaVersion} from './src/lib/ollama';
import {streamOllamaFile} from './src/lib/ollama-download';
const digest='sha256:'+'a'.repeat(64);
export default {async fetch(request){
 const version=await resolveOllamaVersion('qwen3','latest',async(url,options)=>{
  // Constructing a native Worker Request catches unsupported fetch options.
  new Request(url,options);
  return Response.json({schemaVersion:2,format:'gguf',config:{mediaType:'config',digest:'sha256:'+'b'.repeat(64),size:2},layers:[{mediaType:'application/vnd.ollama.image.model',digest,size:16}]});
 });
 return streamOllamaFile(request,'qwen3',version.files[0],async(url,options)=>{
  new Request(url,options);
  const range=options.headers.get('range');const text='GGUFabcdefghijkl';
  if(range){const [,start,end]=/bytes=(\\d+)-(\\d+)/.exec(range);return new Response(text.slice(+start,+end+1),{status:206,headers:{'content-range':'bytes '+start+'-'+end+'/16','content-length':String(+end- +start+1)}});}
  return new Response(text,{headers:{'content-length':'16'}});
 });
}};`},bundle:true,write:false,platform:'browser',format:'esm'});
const runtime=new Miniflare(convertV4MiniflareOptions({modules:true,script:outputFiles[0].text,compatibilityDate:'2026-08-27',compatibilityFlags:['nodejs_compat','global_fetch_strictly_public']}));
try{
 const response=await runtime.dispatchFetch('http://localhost/download');assert.equal(response.status,200);assert.equal(await response.text(),'GGUFabcdefghijkl');assert.match(response.headers.get('content-disposition'),/qwen3-latest-model.gguf/);
 const head=await runtime.dispatchFetch('http://localhost/download',{method:'HEAD'});assert.equal(head.headers.get('content-length'),'16');assert.equal(await head.text(),'');
 const range=await runtime.dispatchFetch('http://localhost/download',{headers:{range:'bytes=4-8'}});assert.equal(range.status,206);assert.equal(await range.text(),'abcde');
 console.log('OK: real Cloudflare Worker accepts metadata fetch options and streams named files, HEAD and exact byte ranges.');
}finally{await runtime.dispose();}

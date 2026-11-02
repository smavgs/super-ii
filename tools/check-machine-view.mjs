import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url), wranglerRequire=createRequire(require.resolve('wrangler/package.json'));
const {Miniflare,convertV4MiniflareOptions}=wranglerRequire('miniflare');
const {outputFiles}=await build({stdin:{resolveDir:process.cwd(),contents:`
import {pageMarkdown,representPage,publicMachinePath,machinePage,ollamaDocument,ollamaMarkdown} from './src/lib/machine-view';
const html='<html><head><title>Model &amp; dataset</title></head><body><header>Navigation should be omitted</header><main><h1>Actual content</h1><p>One <a href="/models?q=a&amp;sort=new">model</a> and a dataset.</p><ul><li>First</li><li>Second</li></ul><pre>ollama run qwen3\\nnext command</pre><div hidden>Hidden error</div><form><input value="secret"><p>Private form</p></form><script>secret()</script><dialog>Draft modal</dialog><p>中文 Русский</p></main></body></html>';
export default {async fetch(request){const url=new URL(request.url);
 if(url.pathname==='/paths')return Response.json({public:['/','/zh-cn/models','/models/smavgs/ollama-qwen3','/robots','/people/smavgs','/products/company/product','/legal/privacy'].map(publicMachinePath),private:['/account','/workspace/workrooms/abc','/repositories/abc/edit','/new','/organizations/new','/papers/new','/api/notifications','/c/private-token','/sign-in'].map(publicMachinePath)});
 if(url.pathname==='/ollama'){const item={id:'7fc7fc6f-3382-43cb-9ef6-97e7054bde2d',title:'Qwen',owner_handle:'smavgs',summary:'Original model',card_markdown:'# Source card',source_url:'https://ollama.com/library/qwen3',source_metadata:{},provider_slug:'qwen3'};const files=[{filename:'qwen3-latest-model.gguf',digest:'sha256:'+'a'.repeat(64),size:16,label:'Model weights',weight:true,mediaType:'application/vnd.ollama.image.model'}];return Response.json({json:ollamaDocument(item,url.origin,'latest',files),markdown:ollamaMarkdown(item,url,'latest',files)});}
 return representPage(new Response(html,{headers:{'content-type':'text/html'}}),url,url.searchParams.get('view'),request.headers.get('accept')??'text/markdown');
}};`},bundle:true,write:false,platform:'browser',format:'esm',logLevel:'silent'});
const runtime=new Miniflare(convertV4MiniflareOptions({modules:true,script:outputFiles[0].text,compatibilityDate:'2026-08-27',compatibilityFlags:['nodejs_compat']}));
try{
 const paths=await (await runtime.dispatchFetch('http://localhost/paths')).json();assert(paths.public.every(Boolean));assert(paths.private.every(x=>!x));
 const raw=await runtime.dispatchFetch('http://localhost/?view=markdown');assert.match(raw.headers.get('content-type'),/text\/markdown/);const md=await raw.text();
 assert.match(md,/# Actual content/);assert.match(md,/\[model\]\(<http:\/\/localhost\/models\?q=a&sort=new>\)/);assert.match(md,/ollama run qwen3\nnext command/);assert.match(md,/中文 Русский/);
 for(const secret of ['secret','Private form','Hidden error','Draft modal','Navigation should'])assert(!md.includes(secret),secret);
 const view=await (await runtime.dispatchFetch('http://localhost/?view=machine')).text();assert.match(view,/data-copy-machine/);assert.match(view,/Raw Markdown/);assert.match(view,/aria-current="page">Machine/);
 const json=await (await runtime.dispatchFetch('http://localhost/',{headers:{accept:'application/json'}})).json();assert.equal(json.content_markdown,md);assert.equal(json.url,'http://localhost/');
 const ollama=await (await runtime.dispatchFetch('http://localhost/ollama')).json();assert.equal(ollama.json.weights_stored_by_superii,false);assert.match(ollama.json.files[0].download_url,/\/api\/ollama\/.+\/download\?tag=latest&file=sha256/);assert.match(ollama.markdown,/qwen3-latest-model.gguf/);
 console.log('OK: Worker machine view preserves public text, code, languages and links; excludes forms/scripts/dialogs; rejects private route eligibility; provides real Ollama file links.');
}finally{await runtime.dispose();}

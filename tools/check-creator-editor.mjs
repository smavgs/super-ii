import assert from 'node:assert/strict';
import { createServer } from 'vite';
import path from 'node:path';

const root = path.resolve(import.meta.dirname,'..');
const vite = await createServer({root, appType:'custom',server:{middlewareMode:true},resolve:{alias:{'@':path.join(root,'src')}}});
try {
  const { readCard, uploadPath, suggestedSlug, creatorTemplate } = await vite.ssrLoadModule('/src/lib/creator-card.ts');
  const { renderRepositoryMarkdown } = await vite.ssrLoadModule('/src/lib/repository-markdown.ts');
  const imported = '---\nlicense: apache-2.0\npipeline_tag: text-generation\ntitle: "My model"\nevil: !!js/function x\n---\n# Overview\n\nUseful description.\n';
  const parsed=readCard(imported);
  assert.equal(parsed.metadata.license,'apache-2.0');assert.equal(parsed.metadata.evil,undefined);
  assert.equal(parsed.title,'My model');assert.equal(parsed.summary,'Useful description.');
  assert.equal(uploadPath('photo.png','bundle/images/photo.png',true),'images/photo.png');
  assert.equal(uploadPath('README.md','bundle/README.md',true),'README.md');
  for(const value of ['../private','/root','a\\b','a//b','a/./b','a\u0000b'])assert.equal(uploadPath(value,'',false),null,value);
  assert.equal(suggestedSlug('My great model!'),'my-great-model');
  assert.match(creatorTemplate('model','Mine'),/No evaluation evidence has been supplied/);
  const files=[{path:'images/photo.png',mime_type:'image/png',url:'/api/repositories/repo/files/image?inline=1'},
    {path:'README.md',mime_type:'text/markdown',url:'/api/repositories/repo/files/card'}];
  const context={files,sourceUrl:'https://huggingface.co/owner/model'};
  const rendered=renderRepositoryMarkdown(`${imported}\n![Local](images/photo.png)\n![Imported](https://huggingface.co/owner/model/resolve/main/images/photo.png)\n[Readme](README.md)\n![Track](https://evil.example/track.png)\n<img src=x onerror=alert(1)>\n[x](javascript:alert(1))`,context);
  assert.equal((rendered.match(/<img /g)??[]).length,2);
  assert.match(rendered,/href="\/api\/repositories\/repo\/files\/card"/);
  assert.doesNotMatch(rendered,/<img[^>]+evil\.example|<img src=x|href="javascript:|<script/i);
  assert.match(rendered,/external image/);assert.doesNotMatch(rendered,/license: apache/);
  for(const url of ['data:image/svg+xml,evil','javascript:alert(1)','https://%','https://user:password@example.com/x']) {
    const result=renderRepositoryMarkdown(`![x](${url})`,context);
    assert.doesNotMatch(result,/<img /);
  }
  assert.doesNotMatch(renderRepositoryMarkdown('![svg](images/a.svg)',{files:[{path:'images/a.svg',mime_type:'image/svg+xml',url:'/api/repositories/repo/files/svg'}]}),/<img /);
  const { translateCreator, creatorRussian, creatorChinese } = await vite.ssrLoadModule('/src/lib/creator-localization.ts');
  for (const key of Object.keys(creatorRussian)) {
    assert.ok(creatorChinese[key],`missing Chinese control: ${key}`);
    assert.notEqual(creatorRussian[key],key);
    assert.notEqual(creatorChinese[key],key);
  }
  assert.equal(translateCreator('{count} files','zh-CN',{count:3}),'3 个文件');
  console.log('OK: creator suggestions, folder paths, honest templates, safe images, imported links and card preview rendering');
} finally {await vite.close();}

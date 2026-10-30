// Import an explicitly reviewed product-to-file manifest. No matching guesses or remote fetches.
import {readFile,writeFile,mkdir,unlink} from 'node:fs/promises';
import {resolve,dirname,join,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const rows=JSON.parse(await readFile(resolve(process.argv[2]),'utf8'));
const index=JSON.parse(await readFile(join(root,'src/content/robot-reference-index.json'),'utf8'));
const byId=new Map(index.map(x=>[x.id,x]));
const media=JSON.parse(await readFile(join(root,'src/content/robot-reference-media.json'),'utf8'));
const inventory=[];const updates=[];const seen=new Set();
const output=join(root,'public/robot-media/products');await mkdir(output,{recursive:true});
for(const row of rows){
 if(!row.match||seen.has(row.match)||byId.get(row.match)?.record_type!=='product')throw new Error('Unreviewed or duplicate product mapping: '+row.file);
 seen.add(row.match);
 const original=await readFile(row.path);const file=row.match+'.webp';
 // Web delivery encoding preserves the original composition and proportions. Originals stay in Drive.
 const bytes=await sharp(original,{limitInputPixels:100_000_000}).rotate().resize({width:1200,height:1200,fit:'inside',withoutEnlargement:true}).webp({quality:86,effort:5}).toBuffer();
 await writeFile(join(output,file),bytes);
 if(extname(row.path).toLowerCase()!=='.webp')await unlink(join(output,row.match+extname(row.path).toLowerCase())).catch(()=>{});
 const uri='https://www.superii.site/robot-media/products/'+file;
 const path=join(root,'public/robot-library/records',row.match+'.json');const doc=JSON.parse(await readFile(path,'utf8'));
 const picture={url:uri,source_url:doc.website||doc.resources?.find(r=>r.url)?.url||'',alt:doc.name};
 doc.images=[picture,...(doc.images??[]).filter(p=>!p.url.includes('/robot-media/products/')).slice(0,11)];
 doc.seed.external_images=doc.images;await writeFile(path,JSON.stringify(doc)+'\n');byId.get(row.match).cover=uri;
 media[row.match]={...media[row.match],images:doc.images,source:picture.source_url,supplied_original:true};
 inventory.push({product_id:row.match,file,original_name:row.file,original_sha256:createHash('sha256').update(original).digest('hex'),sha256:createHash('sha256').update(bytes).digest('hex'),original_bytes:original.length,bytes:bytes.length,match_evidence:row.evidence||'Exact manufacturer and model name'});
 const quote=v=>"'"+JSON.stringify(v).replaceAll("'","''")+"'::jsonb";
 updates.push(`update app.robot_reference_records set document=jsonb_set(jsonb_set(document,'{cover}',${quote(uri)}),'{seed,external_images}',${quote(doc.images)}) where id='${row.match}';`);
}
await writeFile(join(root,'src/content/robot-reference-index.json'),JSON.stringify(index)+'\n');
await writeFile(join(root,'src/content/robot-reference-media.json'),JSON.stringify(media,null,2)+'\n');
await writeFile(join(root,'src/content/robot-supplied-media.json'),JSON.stringify(inventory,null,2)+'\n');
await writeFile(join(root,'database/migrations/0041_robot_supplied_media.sql'),'-- User-supplied original photographs, delivered as proportion-preserving WebP previews.\nbegin;\n'+updates.join('\n')+'\ncommit;\n');
console.log(JSON.stringify({images:inventory.length,originalBytes:inventory.reduce((n,i)=>n+i.original_bytes,0),webBytes:inventory.reduce((n,i)=>n+i.bytes,0)}));

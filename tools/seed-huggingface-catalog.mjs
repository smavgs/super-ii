// Prepare a reviewable import only. No credentials, downloads or DB connection.
import { readFile, writeFile } from 'node:fs/promises';
const args=process.argv.slice(2);
const arg=name=>args.includes(name)?args[args.indexOf(name)+1]:undefined;
const owner=arg('--owner'), destination=arg('--out');
if (!owner || !/^[a-z0-9][a-z0-9-]{1,49}$/.test(owner) || !destination) throw new Error('Usage: node tools/seed-huggingface-catalog.mjs --owner smavgs --out /absolute/import.sql');
const catalogue=JSON.parse(await readFile(arg('--input') ?? new URL('../src/data/huggingface-catalog.json',import.meta.url),'utf8'));
const input=catalogue.items.map(item=>{
  const segment=item.kind==='dataset'?'datasets':item.kind==='space'?'spaces':null;
  if(!segment || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/.test(item.repo_id) ||
    item.source_url!==`https://huggingface.co/${segment}/${item.repo_id}` || !/^[a-f0-9]{40,64}$/.test(item.revision) ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(item.id) ||
    typeof item.title!=='string' || !item.title.trim() || item.title.length>200 || typeof item.summary!=='string' || item.summary.length>2000 ||
    !item.metadata || typeof item.metadata!=='object' || Buffer.byteLength(JSON.stringify(item.metadata))>32768 ||
    [item.downloads,item.likes].some(n=>n!==null && (!Number.isSafeInteger(n)||n<0)) ||
    (item.license!==null && (typeof item.license!=='string'||item.license.length>120))) throw new Error(`Invalid source listing: ${item.repo_id}`);
  const [namespace,slug]=item.repo_id.split('/');
  const card=`## Source and authorship\n\n${item.summary}\n\nSource publisher: **${namespace}**. Curated by @${owner} from [${item.repo_id}](${item.source_url}) on Hugging Face. This listing does not claim authorship or endorsement.\n\n## Access and use\n\n${item.metadata.gated ? 'The original provider requires access approval. Use your own Hugging Face account to request it. No private access is shared by Super ii.' : 'Public source files can be browsed and downloaded from the Files tab. Files remain with Hugging Face.'}\n\n${item.kind==='space' ? 'The hosted app runs on Hugging Face; its creator controls availability, terms, accounts and any charges. Local use requires the original app dependencies and runtime.' : 'Large datasets can contain many shards, videos and metadata files. Select individual files or use the complete-snapshot command in Use locally.'}\n\n## License\n\n${item.license ? `Source license label: ${item.license}.` : 'No license label was provided in the source metadata.'} Review the [original source and its terms](${item.source_url}) before use or redistribution.\n`;
  return {...item,namespace,slug,card};
});
if(input.length!==new Set(input.map(i=>i.kind+':'+i.repo_id.toLowerCase())).size || input.length!==new Set(input.map(i=>i.id)).size) throw new Error('Duplicate source listings.');
const q=value=>`'${String(value).replaceAll("'","''")}'`;
const sql=`begin;
select pg_advisory_xact_lock(hashtextextended(${q(owner+':hf-curation')},0));
do $$ begin
 if not exists(select 1 from app.profiles where handle=${q(owner)} and is_public) then raise exception 'Public curator profile required'; end if;
end $$;
with input as (select * from jsonb_to_recordset(${q(JSON.stringify(input))}::jsonb)
 as source(id uuid,kind text,repo_id text,namespace text,slug text,source_url text,revision text,title text,summary text,license text,downloads bigint,likes bigint,metadata jsonb,card text)),
curator as (select id from app.profiles where handle=${q(owner)} and is_public),
updated as (
 update app.external_catalog_items item set source_revision=input.revision,license=input.license,
 provider_downloads=input.downloads,provider_likes=input.likes,
 source_metadata=input.metadata||jsonb_build_object('curator_edited',coalesce(item.source_metadata->>'curator_edited','false')='true'),
 title=case when item.source_metadata->>'curator_edited'='true' then item.title else input.title end,
 summary=case when item.source_metadata->>'curator_edited'='true' then item.summary else input.summary end,
 card_markdown=case when item.source_metadata->>'curator_edited'='true' then item.card_markdown else input.card end,
 last_checked_at=now()
 from input,curator where item.owner_profile_id=curator.id and item.provider='huggingface' and item.is_curated
 and item.kind::text=input.kind and lower(item.provider_repo_id)=lower(input.repo_id) and item.status<>'removed'
 returning item.id)
insert into app.external_catalog_items(id,owner_profile_id,provider,is_curated,kind,provider_repo_id,provider_namespace,provider_slug,
 source_url,source_revision,title,summary,license,file_count,total_size_bytes,provider_downloads,provider_likes,source_metadata,card_markdown,last_checked_at)
 select input.id,curator.id,'huggingface',true,input.kind::public.repository_kind,input.repo_id,input.namespace,input.slug,
 input.source_url,input.revision,input.title,input.summary,input.license,0,0,input.downloads,input.likes,input.metadata,input.card,now()
 from input cross join curator
 where not exists(select 1 from app.external_catalog_items item where item.owner_profile_id=curator.id and item.provider='huggingface' and item.kind::text=input.kind and lower(item.provider_repo_id)=lower(input.repo_id))
 and not exists(select 1 from app.repositories repository where repository.owner_profile_id=curator.id and repository.kind::text=input.kind and repository.slug='hf-'||input.id::text);
commit;
select kind,status,count(*) from app.external_catalog_items where provider='huggingface' and is_curated
 and owner_profile_id=(select id from app.profiles where handle=${q(owner)}) group by kind,status order by kind,status;
`;
await writeFile(destination,sql);
console.log(`Prepared ${input.length} curated metadata listings for @${owner}. Creator-owned links, removed entries and curator edits are preserved.`);

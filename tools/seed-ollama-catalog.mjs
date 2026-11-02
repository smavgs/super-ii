// Prepare a reviewable, idempotent SQL import. This command never connects to a DB.
import { readFile, writeFile } from "node:fs/promises";
const args = process.argv.slice(2);
const owner = args[args.indexOf("--owner") + 1];
const destination = args[args.indexOf("--out") + 1];
if (
  !args.includes("--owner") ||
  !args.includes("--out") ||
  !/^[a-z0-9][a-z0-9-]{1,49}$/.test(owner) ||
  !destination
)
  throw new Error(
    "Usage: node tools/seed-ollama-catalog.mjs --owner smavgs --out /absolute/import.sql",
  );
const catalogue = JSON.parse(
  await readFile(
    new URL("../src/data/ollama-catalog.json", import.meta.url),
    "utf8",
  ),
);
const models = catalogue.models.map((model) => {
  if (
    !/^[a-z0-9][a-z0-9._-]{0,99}$/.test(model.slug) ||
    model.sourceUrl !== `https://ollama.com/library/${model.slug}`
  )
    throw new Error("Invalid catalogue source");
  const usable =
    model.manifest?.layers.filter((layer) =>
      /^application\/vnd\.ollama\.image\.(model|projector|adapter|template|system|params|license)$/.test(
        layer.mediaType,
      ),
    ) ?? [];
  const format = model.manifest?.format || model.config?.model_format || "";
  const metadata = {
    library: "Ollama",
    format,
    capabilities: model.capabilities,
    sizes: model.sizes,
    checked_at: model.checkedAt,
    catalogue_source: catalogue.source,
    catalogue_sha256: catalogue.sourceSha256,
    source_updated_at: model.sourceUpdatedAt,
    model_family: model.config?.model_family ?? "",
    parameter_size: model.config?.model_type ?? "",
    quantization: model.config?.file_type ?? "",
    manifest:
      model.manifest && JSON.stringify(model.manifest).length < 28000
        ? model.manifest
        : null,
  };
  const card = `# ${model.title}\n\n${model.summary}\n\n## Source and authorship\n\nThis page is curated by @${owner}. The original model and its authors are identified in the [Ollama model card](${model.sourceUrl}). Inclusion here does not claim authorship or endorsement.\n\n## Available information\n\n${model.capabilities.length ? `- Source capabilities: ${model.capabilities.join(", ")}.\n` : ""}${model.sizes.length ? `- Source size variants: ${model.sizes.join(", ")}.\n` : ""}${format ? `- Default file format: ${format}.\n` : ""}${model.config?.model_type ? `- Default parameter size: ${model.config.model_type}.\n` : ""}${model.config?.file_type ? `- Default quantization: ${model.config.file_type}.\n` : ""}\nSelect **Files & versions** for downloadable files and their source checksums. Tags and availability can change at Ollama.\n\n## Use and limitations\n\nThe Download button saves the selected file; it does not install or run a model. Some models require companion files and a compatible runtime. Read the original model card for hardware requirements, intended use and limitations. Super ii has not tested this model's execution or output quality.\n\n## License\n\nFollow the [upstream model terms](${model.sourceUrl}) and the license file, when listed. Publishing this curated page does not change those terms.\n\n## Catalogue provenance\n\nListed from [AILocalClick](https://github.com/smavgs/ailocalclick), which indexes Ollama's official library.\n`;
  return {
    slug: model.slug,
    title: model.title,
    summary: model.summary,
    revision: model.manifestDigest?.slice(7) ?? null,
    files: usable.length,
    total: usable.reduce((sum, layer) => sum + layer.size, 0),
    metadata,
    card,
  };
});
if (models.length !== new Set(models.map((m) => m.slug)).size)
  throw new Error("Duplicate catalogue model");
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const sql = `begin;
do $$ begin
 if not exists(select 1 from app.profiles where handle=${quote(owner)} and is_public) then raise exception 'Public curator profile is required'; end if;
end $$;
with input as (select * from jsonb_to_recordset(${quote(JSON.stringify(models))}::jsonb)
 as model(slug text,title text,summary text,revision text,files integer,total bigint,metadata jsonb,card text)),
curator as (select id from app.profiles where handle=${quote(owner)} and is_public),
updated as (
 update app.external_catalog_items item set source_revision=input.revision,file_count=input.files,total_size_bytes=input.total,
 source_metadata=input.metadata||jsonb_build_object('curator_edited',coalesce((item.source_metadata->>'curator_edited')::boolean,false)),
 title=case when item.source_metadata->>'curator_edited'='true' then item.title else input.title end,
 summary=case when item.source_metadata->>'curator_edited'='true' then item.summary else input.summary end,
 card_markdown=case when item.source_metadata->>'curator_edited'='true' then item.card_markdown else input.card end,
 last_checked_at=now()
 from input,curator where item.owner_profile_id=curator.id and item.provider='ollama' and item.provider_slug=input.slug
 returning item.id)
insert into app.external_catalog_items(owner_profile_id,provider,kind,provider_repo_id,provider_namespace,provider_slug,
 source_url,source_revision,title,summary,file_count,total_size_bytes,source_metadata,card_markdown)
 select curator.id,'ollama','model','library/'||input.slug,'library',input.slug,'https://ollama.com/library/'||input.slug,
 input.revision,input.title,input.summary,input.files,input.total,input.metadata,input.card from input cross join curator
 where not exists(select 1 from app.external_catalog_items item where item.owner_profile_id=curator.id and item.provider='ollama' and item.provider_slug=input.slug)
 and not exists(select 1 from app.repositories repository where repository.owner_profile_id=curator.id and repository.kind='model' and repository.slug='ollama-'||input.slug);
commit;
select status,count(*) from app.external_catalog_items where provider='ollama' and owner_profile_id=(select id from app.profiles where handle=${quote(owner)}) group by status;
`;
await writeFile(destination, sql);
console.log(
  `Prepared ${models.length} metadata-only listings for @${owner}. Existing edits and removed listings are preserved. SQL: ${destination}`,
);

// Offline conversion only: never fetches sources, publishes stories or sends mail.
import { readdir, readFile, mkdir, writeFile, stat } from "node:fs/promises";
import { resolve, join } from "node:path";
import sharp from "sharp";
const [sourceArg, outputArg] = process.argv.slice(2);
if (!sourceArg || !outputArg)
  throw new Error(
    "Usage: node tools/prepare-sigma-pack.mjs SOURCE_DIRECTORY NEW_OUTPUT_DIRECTORY",
  );
const source = resolve(sourceArg),
  output = resolve(outputArg);
if (source === output) throw new Error("Choose a separate output directory.");
await mkdir(output, { recursive: false });
const manifest = [];
for (const folder of (await readdir(source, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .sort((a, b) => a.name.localeCompare(b.name))) {
  const directory = join(source, folder.name);
  const translations = {};
  for (const [locale, filename] of [
    ["en", "article.txt"],
    ["ru", "article.ru.txt"],
    ["zh-CN", "article.zh-CN.txt"],
  ]) {
    const raw = (await readFile(join(directory, filename), "utf8")).trim();
    const parts = raw.split(/\r?\n\s*\r?\n/);
    const title = parts.shift().trim();
    const summary = parts[0]?.length <= 500 ? parts.shift().trim() : "";
    const body = parts.join("\n\n").trim();
    if (title.length < 3 || title.length > 300 || !body || body.length > 30_000)
      throw new Error(`Review text bounds: ${folder.name}/${filename}`);
    translations[locale] = { title, summary, body };
  }
  const links = [
    ...translations.en.body.matchAll(/https:\/\/[^\s<>\])]+/g),
  ].map((match) => match[0].replace(/[.,;]+$/, ""));
  const primary = links.at(-1);
  if (!primary) throw new Error(`Add a primary-source URL: ${folder.name}`);
  const title = translations.en.title;
  const category = /robot|stretch/i.test(title)
    ? "robotics"
    : /satellite|orbital|hardware/i.test(title)
      ? "hardware"
      : /bench|prove|physics/i.test(title)
        ? "research"
        : /mcp|skill/i.test(title)
          ? "agents"
          : "models";
  const images = [];
  for (const filename of (await readdir(directory))
    .filter((name) => /^pic-\d+\.(png|jpe?g|webp|gif)$/i.test(name))
    .sort()
    .slice(0, 2)) {
    const input = join(directory, filename);
    if ((await stat(input)).size > 20_000_000)
      throw new Error(`Image is too large: ${filename}`);
    let bytes = await sharp(input, {
      animated: false,
      limitInputPixels: 48_000_000,
    })
      .rotate()
      .resize({
        width: 1800,
        height: 1800,
        fit: "inside",
        withoutEnlargement: true,
      })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 82 })
      .toBuffer();
    if (bytes.length > 800_000)
      bytes = await sharp(bytes)
        .resize({
          width: 1400,
          height: 1400,
          fit: "inside",
          withoutEnlargement: true,
        })
        .jpeg({ quality: 65 })
        .toBuffer();
    images.push({
      data: `data:image/jpeg;base64,${bytes.toString("base64")}`,
      alt: title,
      credit: `Source image: ${new URL(primary).hostname}. Reuse permission needs review.`,
      source_url: primary,
    });
  }
  const bundle = {
    format: "superii-sigma-draft-v1",
    research_only: true,
    editorial_note:
      "Supplied research pack. Its harvesting script copied third-party prose. Review attribution, rewrite as original reporting where needed, verify dates and claims against the primary source, and confirm image permissions before publishing. Import always resets the publication permission checkbox.",
    document: {
      source_language: "en",
      category,
      translations,
      sources: [{ label: new URL(primary).hostname, url: primary }],
      images: [],
      rights_confirmed: false,
    },
    images,
  };
  const filename = `${folder.name}.json`;
  await writeFile(join(output, filename), JSON.stringify(bundle));
  manifest.push({
    filename,
    title,
    languages: Object.keys(translations),
    images: images.length,
    source: primary,
    status: "research draft",
  });
}
await writeFile(
  join(output, "manifest.json"),
  JSON.stringify(manifest, null, 2),
);
await writeFile(
  join(output, "README.txt"),
  "Sigma News research drafts\n\nOpen /sigma/editor, sign in, choose Import draft and select one numbered JSON file. English, Russian, Chinese and up to two images are imported together. Saving and importing are private. Review the supplied text, dates, source attribution and image permissions; the imported articles are not presented as original Sigma reporting. Then confirm the rights checkbox and submit for review. Only an authorized editor can publish. Newsletter delivery is a separate administrator action.\n\nNo source files were changed. No publication or email was performed by this converter.\n",
);
console.log(
  `Prepared ${manifest.length} private draft bundles, ${manifest.reduce((sum, item) => sum + item.images, 0)} images, and three languages in ${output}`,
);

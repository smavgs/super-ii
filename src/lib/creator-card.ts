export const CARD_MAX_BYTES = 100_000;
export type CreatorDetails = {
  title: string; summary: string; task: string; library: string; modality: string;
  card_markdown: string;
};

// Read a small scalar subset of Hugging Face front matter. Never execute YAML
// tags, aliases, nested objects or expressions from an imported README.
export function readCard(source: string) {
  const normalized = source.replace(/^\uFEFF/, '').replaceAll('\r\n', '\n');
  const match = normalized.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  const metadata: Record<string, string> = {};
  if (match) {
    for (const line of match[1].split('\n')) {
      const scalar = line.match(/^([a-z_][a-z0-9_-]*):\s*([^\n]*)$/i);
      if (!scalar) continue;
      let value = scalar[2].trim();
      if (/^[!&*|>\[{]/.test(value)) continue;
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      if (value.length <= 2_000) metadata[scalar[1]] = value;
    }
  }
  const body = match ? normalized.slice(match[0].length) : normalized;
  const heading = body.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? '';
  const paragraph = body.split(/\n\s*\n/).map((line) => line.trim()).find((line) =>
    line && !/^[#>|!`<\-]/.test(line) && !line.includes('|')) ?? '';
  return { body, metadata, title: metadata.title || heading,
    summary: metadata.description || paragraph.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').slice(0, 2_000) };
}

export function suggestedSlug(title: string) {
  return title.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-').replace(/^[-._]+|[-._]+$/g, '').slice(0, 96).replace(/[-._]+$/g, '');
}

export function creatorTemplate(kind: string, title: string) {
  const name = title.trim() || (kind === 'dataset' ? 'Dataset' : kind === 'space' ? 'App' : 'Model');
  return `# ${name}\n\nDescribe what this work does and who it is for.\n\n## Getting started\n\nAdd installation requirements and a minimal usage example.\n\n## Files\n\n| File | Purpose |\n| --- | --- |\n| Add a filename | Describe its contents |\n\n## Authorship and sources\n\nCredit the original creators and describe your contribution.\n\n## Evaluation\n\nNo evaluation evidence has been supplied yet. Add the exact test, environment, result and limitations when available.\n\n## Limitations\n\nDescribe known limitations and uses that have not been tested.\n\n## License\n\nState the license and any upstream requirements.\n`;
}

export function uploadPath(name: string, relativePath: string, folder: boolean): string | null {
  const source = folder && relativePath.includes('/') ? relativePath.slice(relativePath.indexOf('/') + 1) : name;
  const normalized = source.normalize('NFC');
  if (!normalized || normalized.length > 1024 || /[\\\u0000-\u001f\u007f]/.test(normalized)) return null;
  if (normalized.split('/').some((part) => !part || part === '.' || part === '..')) return null;
  return normalized;
}

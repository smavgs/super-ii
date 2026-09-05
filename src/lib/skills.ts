export const SKILLS_SOURCE_URL = 'https://smavgs.github.io/make-great-agents/api/agents.json';
export const SKILLS_FEED_VERSION = 1;

export type Skill = {
  slug: string;
  name: string;
  category: string;
  integrations: string[];
  prompt: string;
};

export type SkillsCatalog = {
  version: typeof SKILLS_FEED_VERSION;
  skills: Skill[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCleanText(value: unknown, maxLength: number): value is string {
  return typeof value === 'string'
    && Boolean(value.trim())
    && value.length <= maxLength
    && !/[\0\u0001-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
}

export function parseSkillsCatalog(value: unknown): SkillsCatalog | null {
  if (!isRecord(value) || value.version !== SKILLS_FEED_VERSION || !Array.isArray(value.agents)) return null;
  if (value.agents.length < 1 || value.agents.length > 1_000) return null;

  const skills: Skill[] = [];
  const slugs = new Set<string>();
  for (const entry of value.agents) {
    if (!isRecord(entry)
      || !isCleanText(entry.slug, 80)
      || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.slug)
      || !isCleanText(entry.name, 120)
      || !isCleanText(entry.category, 80)
      || !isCleanText(entry.prompt, 8_000)
      || !Array.isArray(entry.integrations)
      || entry.integrations.length > 12
      || entry.integrations.some((item) => !isCleanText(item, 80))
      || slugs.has(entry.slug)) return null;

    slugs.add(entry.slug);
    skills.push({
      slug: entry.slug,
      name: entry.name.trim(),
      category: entry.category.trim(),
      integrations: entry.integrations.map((item) => (item as string).trim()),
      // The public setup prompt is the product payload. Keep its wording intact.
      prompt: entry.prompt,
    });
  }

  return { version: SKILLS_FEED_VERSION, skills };
}

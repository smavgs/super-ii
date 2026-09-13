import additionsSource from '../content/skills-additions.json' with { type: 'json' };

export const SKILLS_SOURCE_URL = 'https://smavgs.github.io/make-great-agents/api/agents.json';
export const SKILLS_FEED_VERSION = 1;
export const MAX_SKILL_PROMPT_LENGTH = 40_000;

export type SkillVariable = {
  name: string;
  default: string;
};

export type Skill = {
  slug: string;
  name: string;
  category: string;
  integrations: string[];
  prompt: string;
  tags?: string[];
  variables?: SkillVariable[];
  bestWith?: string[];
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

function isOptionalCleanText(value: unknown, maxLength: number): value is string {
  return typeof value === 'string'
    && value.length <= maxLength
    && !/[\0\u0001-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
}

function parseTextList(value: unknown, maxItems: number): string[] | null {
  if (!Array.isArray(value)
    || value.length > maxItems
    || value.some((item) => !isCleanText(item, 80))) return null;
  return value.map((item) => (item as string).trim());
}

function parseVariables(value: unknown): SkillVariable[] | null {
  if (!Array.isArray(value) || value.length > 20) return null;
  const variables: SkillVariable[] = [];
  const names = new Set<string>();
  for (const entry of value) {
    if (!isRecord(entry)
      || !isCleanText(entry.name, 64)
      || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(entry.name)
      || !isOptionalCleanText(entry.default, 600)
      || names.has(entry.name)) return null;
    names.add(entry.name);
    variables.push({ name: entry.name, default: entry.default });
  }
  return variables;
}

function parseSkillEntry(entry: unknown): Skill | null {
  if (!isRecord(entry)
    || !isCleanText(entry.slug, 80)
    || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.slug)
    || !isCleanText(entry.name, 120)
    || !isCleanText(entry.category, 80)
    || !isCleanText(entry.prompt, MAX_SKILL_PROMPT_LENGTH)) return null;

  const integrations = parseTextList(entry.integrations, 12);
  if (!integrations) return null;

  const tags = entry.tags === undefined ? undefined : parseTextList(entry.tags, 20);
  const bestWith = entry.bestWith === undefined ? undefined : parseTextList(entry.bestWith, 12);
  const variables = entry.variables === undefined ? undefined : parseVariables(entry.variables);
  if (tags === null || bestWith === null || variables === null) return null;

  return {
    slug: entry.slug,
    name: entry.name.trim(),
    category: entry.category.trim(),
    integrations,
    // The complete public prompt is the product payload. Keep its wording intact.
    prompt: entry.prompt,
    ...(tags?.length ? { tags } : {}),
    ...(variables?.length ? { variables } : {}),
    ...(bestWith?.length ? { bestWith } : {}),
  };
}

function parseEntries(value: unknown): Skill[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 1_000) return null;
  const skills: Skill[] = [];
  const slugs = new Set<string>();
  for (const entry of value) {
    const skill = parseSkillEntry(entry);
    if (!skill || slugs.has(skill.slug)) return null;
    slugs.add(skill.slug);
    skills.push(skill);
  }
  return skills;
}

export function parseSkillsCatalog(value: unknown): SkillsCatalog | null {
  if (!isRecord(value) || value.version !== SKILLS_FEED_VERSION || !Array.isArray(value.agents)) return null;
  const skills = parseEntries(value.agents);
  return skills ? { version: SKILLS_FEED_VERSION, skills } : null;
}

export function parsePublicSkillsCatalog(value: unknown): SkillsCatalog | null {
  if (!isRecord(value) || value.version !== SKILLS_FEED_VERSION || !Array.isArray(value.skills)) return null;
  const skills = parseEntries(value.skills);
  return skills ? { version: SKILLS_FEED_VERSION, skills } : null;
}

const packagedAdditions = (() => {
  const parsed = parsePublicSkillsCatalog(additionsSource);
  if (!parsed) throw new Error('Packaged Skills additions failed validation');
  return parsed;
})();

export const PACKAGED_SKILL_COUNT = packagedAdditions.skills.length;

export function mergeSkillsCatalog(upstream: SkillsCatalog): SkillsCatalog {
  const skills = [...upstream.skills];
  const slugs = new Set(skills.map((skill) => skill.slug));
  const names = new Set(skills.map((skill) => skill.name.trim().toLocaleLowerCase()));

  for (const addition of packagedAdditions.skills) {
    const normalizedName = addition.name.trim().toLocaleLowerCase();
    if (slugs.has(addition.slug) || names.has(normalizedName)) continue;
    skills.push(addition);
    slugs.add(addition.slug);
    names.add(normalizedName);
  }

  return { version: SKILLS_FEED_VERSION, skills };
}

import { z } from 'zod';
import rawCatalog from '@/content/robot-catalog.json';

const evidenceStateSchema = z.enum(['verified', 'declared', 'derived', 'unknown']);
const evidenceSourceSchema = z.object({
  title: z.string().min(1).max(240),
  publisher: z.string().min(1).max(120),
  url: z.url({ protocol: /^https$/ }),
  kind: z.enum(['official-product', 'official-documentation', 'manufacturer-product']),
  checkedAt: z.iso.date(),
}).strict();

const componentSchema = z.object({
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(100),
  name: z.string().min(1).max(160),
  manufacturer: z.string().min(1).max(120),
  category: z.enum(['compute', 'vision', 'thermal', 'power', 'mobile-base']),
  platforms: z.array(z.enum(['raspberry-pi', 'jetson'])).min(1).max(2),
  audience: z.array(z.string().min(1).max(80)).min(1).max(6),
  summary: z.string().min(10).max(1_000),
  evidenceStatus: evidenceStateSchema,
  profileRevision: z.iso.date(),
  specifications: z.array(z.object({ label: z.string().min(1).max(120), value: z.string().min(1).max(500) }).strict()).max(40),
  interfaces: z.array(z.string().min(1).max(120)).max(30),
  software: z.array(z.string().min(1).max(160)).max(30),
  sources: z.array(evidenceSourceSchema).min(1).max(12),
  unknowns: z.array(z.string().min(1).max(1_000)).max(20),
}).strict();

const compatibilitySchema = z.object({
  left: z.string(),
  right: z.string(),
  dimension: z.enum(['interface', 'electrical', 'mechanical', 'software', 'host-control']),
  status: evidenceStateSchema,
  claim: z.string().min(10).max(2_000),
  conditions: z.array(z.string().min(1).max(1_000)).max(20),
  sourceUrl: z.url({ protocol: /^https$/ }),
  checkedAt: z.iso.date(),
}).strict();

const referenceVariantSchema = z.object({
  id: z.enum(['pi5', 'jetson']),
  name: z.string(),
  audience: z.string(),
  componentSlugs: z.array(z.string()).min(1).max(20),
  why: z.string(),
  openRequirements: z.array(z.string()).min(1).max(20),
}).strict();

const referenceRobotSchema = z.object({
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  title: z.string(),
  summary: z.string(),
  environment: z.string(),
  capabilities: z.array(z.string()),
  notClaimed: z.array(z.string()),
  variants: z.array(referenceVariantSchema).length(2),
  stages: z.array(z.object({ id: z.string(), label: z.string(), copy: z.string() }).strict()).min(1),
  safety: z.string().min(20),
}).strict();

const robotCatalogSchema = z.object({
  schemaVersion: z.literal(1),
  catalogRevision: z.string().min(1).max(40),
  updatedAt: z.iso.date(),
  name: z.literal('Super ii Robot'),
  description: z.string(),
  rankingPolicy: z.string(),
  evidenceStates: z.array(z.object({ id: evidenceStateSchema, label: z.string(), meaning: z.string() }).strict()).length(4),
  components: z.array(componentSchema).min(1).max(500),
  compatibility: z.array(compatibilitySchema).max(5_000),
  referenceRobots: z.array(referenceRobotSchema).min(1).max(50),
  commercial: z.object({
    free: z.array(z.string()),
    pro: z.array(z.string()),
    team: z.array(z.string()),
    manufacturer: z.array(z.string()),
    later: z.array(z.string()),
    ranking: z.string(),
  }).strict(),
}).strict();

export const robotCatalog = robotCatalogSchema.parse(rawCatalog);
export type RobotComponent = z.infer<typeof componentSchema>;
export type RobotCompatibility = z.infer<typeof compatibilitySchema>;
export type ReferenceRobot = z.infer<typeof referenceRobotSchema>;
export type EvidenceState = z.infer<typeof evidenceStateSchema>;

export const makeRobotInputSchema = z.object({
  goal: z.enum(['see', 'follow', 'explore', 'learn']),
  experience: z.enum(['new', 'experienced', 'professional']),
  compute: z.enum(['recommend', 'pi5', 'jetson']),
  environment: z.enum(['indoor', 'controlled-outdoor']),
  budget: z.enum(['under-500', '500-1000', 'over-1000', 'not-sure']),
  owned_components: z.array(z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)).max(30).default([]),
}).strict();

export type MakeRobotInput = z.infer<typeof makeRobotInputSchema>;

const robotSlugSchema = z.string().trim().toLowerCase().regex(/^[a-z0-9](?:[a-z0-9-]{0,94}[a-z0-9])?$/);
export const saveRobotInputSchema = z.object({
  slug: robotSlugSchema,
  title: z.string().trim().min(2).max(160),
  summary: z.string().trim().min(10).max(2_000),
  audience: z.string().trim().min(1).max(160),
  visibility: z.enum(['public', 'private']),
  organization_id: z.uuid().nullable().default(null),
  change_summary: z.string().trim().min(1).max(1_000).default('First Robot plan'),
  planner_input: makeRobotInputSchema,
}).strict();

export const saveRobotVersionInputSchema = z.object({
  change_summary: z.string().trim().min(1).max(1_000),
  planner_input: makeRobotInputSchema,
}).strict();

export const robotHardwareInputSchema = z.object({
  component_slug: robotSlugSchema.nullable().default(null),
  custom_name: z.string().trim().min(1).max(160).nullable().default(null),
  quantity: z.number().int().min(1).max(10_000).default(1),
  notes: z.string().trim().max(2_000).default(''),
  status: z.enum(['available', 'in-use', 'repair', 'retired']).default('available'),
  organization_id: z.uuid().nullable().default(null),
}).strict().superRefine((value, context) => {
  if ((value.component_slug ? 1 : 0) + (value.custom_name ? 1 : 0) !== 1) {
    context.addIssue({ code: 'custom', message: 'provide exactly one of component_slug or custom_name' });
  }
  if (value.component_slug && !robotComponent(value.component_slug)) {
    context.addIssue({ code: 'custom', path: ['component_slug'], message: 'component_slug is not in the current Robot catalog' });
  }
});

export type RobotPlan = {
  schema_version: '1.0';
  catalog_revision: string;
  reference_robot: string;
  title: string;
  summary: string;
  input: MakeRobotInput;
  recommendation: {
    compute: 'pi5' | 'jetson';
    name: string;
    reason: string;
    audience: string;
  };
  components: Array<RobotComponent & { ownership: 'owned' | 'needed' }>;
  compatibility: RobotCompatibility[];
  open_requirements: string[];
  robot_check: Array<{ dimension: string; status: EvidenceState; explanation: string }>;
  stages: ReferenceRobot['stages'];
  safety_approval: false;
  safety: string;
  ranking_policy: string;
};

export function robotComponent(slug: string): RobotComponent | null {
  return robotCatalog.components.find((component) => component.slug === slug) ?? null;
}

export function searchRobotComponents(input: {
  query?: string;
  platform?: 'raspberry-pi' | 'jetson';
  category?: RobotComponent['category'];
  limit?: number;
} = {}): RobotComponent[] {
  const query = input.query?.trim().toLocaleLowerCase('en') ?? '';
  const limit = Math.min(Math.max(Math.trunc(input.limit ?? 20), 1), 50);
  return robotCatalog.components
    .filter((component) => !input.platform || component.platforms.includes(input.platform))
    .filter((component) => !input.category || component.category === input.category)
    .filter((component) => !query || [
      component.name,
      component.manufacturer,
      component.category,
      component.summary,
      ...component.interfaces,
      ...component.software,
    ].join(' ').toLocaleLowerCase('en').includes(query))
    .sort((left, right) => {
      const stateOrder: Record<EvidenceState, number> = { verified: 0, declared: 1, derived: 2, unknown: 3 };
      return stateOrder[left.evidenceStatus] - stateOrder[right.evidenceStatus]
        || left.name.localeCompare(right.name);
    })
    .slice(0, limit);
}

export function componentCompatibility(left: string, right: string): RobotCompatibility[] {
  return robotCatalog.compatibility.filter((claim) => (
    (claim.left === left && claim.right === right)
    || (claim.left === right && claim.right === left)
  ));
}

export function componentCompatibilityClaims(slug: string): RobotCompatibility[] {
  return robotCatalog.compatibility.filter((claim) => claim.left === slug || claim.right === slug);
}

function recommendedCompute(input: MakeRobotInput): 'pi5' | 'jetson' {
  if (input.compute !== 'recommend') return input.compute;
  if (input.experience === 'professional') return 'jetson';
  if (input.goal === 'follow' && input.budget !== 'under-500') return 'jetson';
  return 'pi5';
}

export function makeRobotPlan(input: MakeRobotInput): RobotPlan {
  const reference = robotCatalog.referenceRobots[0];
  const compute = recommendedCompute(input);
  const variant = reference.variants.find((candidate) => candidate.id === compute);
  if (!variant) throw new Error('reference Robot variant is unavailable');
  const owned = new Set(input.owned_components);
  const components = variant.componentSlugs.map(robotComponent).filter((item): item is RobotComponent => Boolean(item));
  const selected = new Set(variant.componentSlugs);
  const compatibility = robotCatalog.compatibility.filter((claim) => selected.has(claim.left) && selected.has(claim.right));

  const openRequirements = [...variant.openRequirements];
  if (input.environment === 'controlled-outdoor') {
    openRequirements.unshift('Rover One has no verified weather or ingress-protection claim; choose and qualify an enclosure before outdoor use.');
  }
  if (input.goal === 'follow') {
    openRequirements.unshift('Person-following behavior needs a selected perception model, privacy review, stop behavior and real supervised testing.');
  }
  if (input.budget === 'under-500' && compute === 'jetson') {
    openRequirements.unshift('The selected Jetson path may not fit the stated budget after the mobile base, camera, power, storage and safety hardware are included.');
  }

  const dimensionStates = new Map<string, EvidenceState>();
  for (const claim of compatibility) {
    const current = dimensionStates.get(claim.dimension);
    if (current === 'unknown' || !current) dimensionStates.set(claim.dimension, claim.status);
  }
  const check = [
    ['Host control', dimensionStates.get('host-control') ?? 'unknown', 'Host-to-base support is manufacturer-declared and still needs an exact integration test.'],
    ['Electrical', dimensionStates.get('electrical') ?? 'unknown', 'Mobile power, cell selection, current draw and protection remain unresolved until measured.'],
    ['Vision', compute === 'pi5' ? 'declared' : 'unknown', compute === 'pi5' ? 'The official Pi camera interface is documented; rover mounting remains unresolved.' : 'Select a camera for the exact Jetson carrier board and JetPack release.'],
    ['Mechanical', 'unknown', 'Mounting, clearance, cable routing and strain relief require dimensions or direct inspection.'],
    ['Safety', 'unknown', 'No physical emergency stop, supervised test result or safety review is recorded yet.'],
  ] satisfies Array<[string, EvidenceState, string]>;

  const goalLabels: Record<MakeRobotInput['goal'], string> = {
    see: 'see its surroundings',
    follow: 'experiment with supervised person following',
    explore: 'explore a controlled indoor area',
    learn: 'teach its maker how a mobile Robot fits together',
  };

  return {
    schema_version: '1.0',
    catalog_revision: robotCatalog.catalogRevision,
    reference_robot: reference.slug,
    title: `${reference.title} · ${variant.name}`,
    summary: `A source-backed starting plan to ${goalLabels[input.goal]}. Unknowns remain visible until direct evidence replaces them.`,
    input,
    recommendation: { compute, name: variant.name, reason: variant.why, audience: variant.audience },
    components: components.map((component) => ({ ...component, ownership: owned.has(component.slug) ? 'owned' : 'needed' })),
    compatibility,
    open_requirements: openRequirements,
    robot_check: check.map(([dimension, status, explanation]) => ({ dimension, status, explanation })),
    stages: reference.stages,
    safety_approval: false,
    safety: reference.safety,
    ranking_policy: robotCatalog.rankingPolicy,
  };
}

export function publicRobotDocument(row: Record<string, unknown>, origin: string) {
  const owner = String(row.owner_handle ?? '');
  const slug = String(row.slug ?? '');
  const canonical = new URL(`/robot/${encodeURIComponent(owner)}/${encodeURIComponent(slug)}`, origin).toString();
  return {
    schema_version: '1.0',
    kind: 'robot',
    id: row.id,
    owner: { handle: owner, display_name: row.owner_display_name, type: row.owner_type },
    slug,
    title: row.title,
    summary: row.summary,
    audience: row.audience,
    status: row.status,
    visibility: row.visibility,
    version: {
      id: row.version_id,
      number: Number(row.version_number ?? 1),
      change_summary: row.change_summary,
      created_at: row.version_created_at,
      plan: row.plan_snapshot,
    },
    created_at: row.created_at,
    updated_at: row.updated_at,
    links: {
      canonical,
      json: new URL(`/api/robot/robots/${encodeURIComponent(owner)}/${encodeURIComponent(slug)}`, origin).toString(),
      robot_mcp: new URL('/mcp/robot', origin).toString(),
    },
  };
}

import systemStateMarkdown from '../../SYSTEM-STATE.md?raw';

export const capabilityStatuses = [
  'designed',
  'implemented',
  'tested',
  'integrated',
  'staging',
  'production',
  'GA',
] as const;

export type CapabilityStatus = (typeof capabilityStatuses)[number];

export type SystemCapability = {
  capability: string;
  status: CapabilityStatus;
  availability: string;
  evidence: string;
};

function tableCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim().replaceAll('`', ''));
}

function parseCapabilities(markdown: string): SystemCapability[] {
  const heading = '## Capability register';
  const start = markdown.indexOf(heading);
  if (start < 0) return [];
  const remainder = markdown.slice(start + heading.length);
  const end = remainder.indexOf('\n## ');
  const section = end < 0 ? remainder : remainder.slice(0, end);
  return section
    .split('\n')
    .filter((line) => line.trim().startsWith('|'))
    .slice(2)
    .map(tableCells)
    .filter((cells) => cells.length === 4 && capabilityStatuses.includes(cells[1] as CapabilityStatus))
    .map(([capability, status, availability, evidence]) => ({
      capability,
      status: status as CapabilityStatus,
      availability,
      evidence,
    }));
}

const snapshotMatch = systemStateMarkdown.match(/^- Snapshot:\s*(.+)$/m);

export const systemState = {
  name: 'Super ii',
  canonicalUrl: 'https://superii.site',
  snapshot: snapshotMatch?.[1]?.trim() ?? 'unknown',
  statusLadder: capabilityStatuses,
  capabilities: parseCapabilities(systemStateMarkdown),
  source: '/system-state.md',
  mcp: '/mcp',
  workMcp: '/mcp/work',
  agents: '/agents',
  a2a: '/.well-known/agent-card.json',
} as const;

export { systemStateMarkdown };

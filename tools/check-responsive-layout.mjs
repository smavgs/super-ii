import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const css = fs.readFileSync(path.join(root, 'src/styles/global.css'), 'utf8');
const assistant = fs.readFileSync(path.join(root, 'src/components/SuperAssistant.astro'), 'utf8');
const aiWorker = fs.readFileSync(path.join(root, 'src/components/AIWorkerStarter.astro'), 'utf8');
const agentBash = fs.readFileSync(path.join(root, 'src/components/AgentBash.astro'), 'utf8');
const footer = fs.readFileSync(path.join(root, 'src/components/Footer.astro'), 'utf8');
const joinTeam = fs.readFileSync(path.join(root, 'src/pages/join-team.astro'), 'utf8');
const siteScript = fs.readFileSync(path.join(root, 'public/scripts/site.js'), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(`Responsive layout check failed: ${message}`);
}

const bodyRule = css.match(/body\s*\{([^}]*)\}/)?.[1] ?? '';
assert(!/min-width\s*:/.test(bodyRule), 'body must not force a minimum viewport width');

for (const requiredCss of [
  'width: min(calc(100% - 2rem), 1440px)',
  '@media (max-width: 1320px)',
  'max-height: calc(100dvh - 1.5rem)',
  'left: calc(1rem + env(safe-area-inset-left))',
  'min-height: min(24rem, calc(100svh - 7.5rem))',
  '@media (max-width: 360px)',
  'font-size: clamp(1.75rem, 13.5vw, 2.25rem)',
  'width: min(24rem, calc(100vw - 1.5rem))',
  '@media (max-width: 1120px)',
  'grid-template-columns: repeat(4, minmax(0, 1fr))',
  '@media (max-width: 420px)',
  'white-space: pre-wrap',
]) {
  assert(css.includes(requiredCss), `global.css is missing ${requiredCss}`);
}

assert(
  /@media \(max-width: 1320px\)[\s\S]*?\.desktop-nav\s*\{[\s\S]*?display:\s*none;[\s\S]*?\.menu-toggle\s*\{[\s\S]*?display:\s*inline-grid;/.test(css),
  'the full header must collapse to its menu before actions can wrap',
);
assert(
  /\.info-tip__popover\s*\{[\s\S]*?max-height:\s*calc\(100dvh - 1\.5rem\);[\s\S]*?overflow:\s*auto;/.test(css),
  'desktop info popovers must remain internally scrollable within short viewports',
);
assert(
  /\.super-assistant\s*\{[\s\S]*?right:\s*auto;[\s\S]*?bottom:[\s\S]*?left:\s*calc\(1rem \+ env\(safe-area-inset-left\)\);/.test(css),
  'the assistant launcher must remain anchored to the bottom-left corner',
);
assert(
  /\.super-assistant__panel\s*\{[\s\S]*?right:\s*auto;[\s\S]*?bottom:\s*calc\(100% \+ 0\.75rem\);[\s\S]*?left:\s*0;/.test(css),
  'the assistant panel must open above the bottom-left launcher',
);
assert(!/@media \(max-width: 700px\)[\s\S]*?\.super-assistant__label\s*\{[\s\S]*?display:\s*none;/.test(css), 'the assistant label must stay visible on narrow screens');
assert(!/\.super-assistant__launcher\s*\{[\s\S]*?width:\s*3rem;[\s\S]*?border-radius:\s*50%;/.test(css), 'the assistant launcher must not collapse into a circle');
assert(
  /\.account-workspace\s*\{[\s\S]*?min-width:\s*0;[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\);/.test(css),
  'the signed-in account workspace must allow its content track to shrink',
);
assert(
  /\.account-card \.sii-clerk-profile-root,[\s\S]*?\.account-card \.sii-clerk-profile-card\s*\{[\s\S]*?width:\s*100% !important;[\s\S]*?max-width:\s*100% !important;/.test(css),
  'the embedded profile panel must remain inside the account card content box',
);
assert(
  /@media \(max-width: 1120px\)[\s\S]*?\.account-shell\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\);[\s\S]*?\.account-nav\s*\{[\s\S]*?repeat\(4, minmax\(0, 1fr\)\);/.test(css),
  'the account sidebar must become a wrapped navigation grid before it crowds the workspace',
);
assert(
  /@media \(max-width: 420px\)[\s\S]*?\.agent-os-picker\s*\{[\s\S]*?grid-template-columns:\s*1fr;[\s\S]*?\.agent-command code\s*\{[\s\S]*?white-space:\s*pre-wrap;/.test(css),
  'Agent Starter controls and commands must fully reflow on very narrow screens',
);
assert(
  /@media \(max-width: 640px\)[\s\S]*?\.ai-worker__summary\s*\{[\s\S]*?grid-template-columns:\s*auto minmax\(0, 1fr\) auto;/.test(css),
  'the collapsed AI Worker summary must reflow before its status crowds the title',
);
assert(
  /@media \(max-width: 420px\)[\s\S]*?\.ai-worker__summary-icon\s*\{[\s\S]*?display:\s*none;/.test(css),
  'the AI Worker summary must remove its decorative icon on very narrow screens',
);
assert(aiWorker.includes('<details class="ai-worker"'), 'AI Worker must remain an on-demand details drawer');
assert(aiWorker.includes("location.hash === '#ai-worker'"), 'AI Worker must open from the Workspace anchor');
assert(agentBash.includes('role="list"') && agentBash.includes('role="listitem"'), 'the logo-only agent rail must remain accessible');
assert((agentBash.match(/icon: '\/brand\/agents\//g) ?? []).length === 14, 'the handoff rail must include all 14 named agent marks');
assert(agentBash.includes('data-agent-bash-copy'), 'the universal agent instruction must remain copyable');
assert(
  /\.agent-bash__logos\s*\{[\s\S]*?overflow-x:\s*auto;/.test(css),
  'the logo rail must scroll horizontally instead of overflowing narrow screens',
);
assert(
  /@media \(max-width: 640px\)[\s\S]*?\.agent-bash__terminal-body\s*\{[\s\S]*?grid-template-columns:\s*1fr;/.test(css),
  'the universal agent terminal must stack before its copy control crowds the instruction',
);
assert(
  /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.agent-bash__logo\s*\{[\s\S]*?animation:\s*none;/.test(css),
  'the agent logo entrance must respect reduced-motion preferences',
);
assert(
  footer.indexOf('X · @superiisite') < footer.indexOf('class="footer-join-team"') && footer.includes('href="/join-team"'),
  'the fluorescent Join Team action must follow the X account in the Company footer',
);
assert(joinTeam.includes('Build Super ii with us.') && joinTeam.includes('Join the Founding Circle'), 'the Join Team page must preserve the supplied invitation');
assert(joinTeam.includes('/contact?interest=founding-circle') && joinTeam.includes('/contact?interest=founding-team'), 'both Join Team paths must lead to working contact choices');
assert(
  /\.footer-column \.footer-join-team\s*\{[\s\S]*?background:\s*var\(--fluoro-pink\);[\s\S]*?color:\s*#071a2f;/.test(css),
  'the footer Join Team action must retain its high-contrast fluorescent-pink treatment',
);
assert(
  /@media \(max-width: 640px\)[\s\S]*?\.join-team-fit__inner ul,[\s\S]*?\.join-team-path__steps\s*\{[\s\S]*?grid-template-columns:\s*1fr;/.test(css),
  'Join Team lists and progression must reflow to one column on narrow screens',
);
assert(
  /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.join-team-hero__copy,[\s\S]*?animation:\s*none;/.test(css),
  'Join Team entrance motion must respect reduced-motion preferences',
);

for (const requiredMarkup of [
  'aria-label="Open Super ii assistant"',
  'class="super-assistant__label"',
  'class="super-assistant__mascot"',
]) {
  assert(assistant.includes(requiredMarkup), `SuperAssistant.astro is missing ${requiredMarkup}`);
}

assert(siteScript.includes("matchMedia('(min-width: 1321px)')"), 'menu JavaScript breakpoint must match the CSS breakpoint');
assert(siteScript.includes('window.innerHeight - panelHeight - viewportPadding'), 'info popover positioning must clamp to the viewport');

console.log('Responsive layout check passed: fluid pages, a horizontally safe agent handoff, a high-contrast Join Team path, a contained account workspace, reflowing Agent Starter and AI Worker controls, stable header behavior, bounded popovers, and a persistent bottom-left assistant.');

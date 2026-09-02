import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const css = fs.readFileSync(path.join(root, 'src/styles/global.css'), 'utf8');
const assistant = fs.readFileSync(path.join(root, 'src/components/SuperAssistant.astro'), 'utf8');
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
  'right: calc(1rem + env(safe-area-inset-right))',
  'min-height: min(24rem, calc(100svh - 7.5rem))',
  '@media (max-width: 360px)',
  'font-size: clamp(1.75rem, 13.5vw, 2.25rem)',
  'inset: calc(5.25rem + env(safe-area-inset-top))',
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
  /\.super-assistant__panel\s*\{[\s\S]*?right:\s*0;[\s\S]*?left:\s*auto;/.test(css),
  'the assistant panel must anchor to the non-content-heavy right edge',
);
assert(
  /@media \(max-width: 700px\)[\s\S]*?\.super-assistant\s*\{[\s\S]*?top:[\s\S]*?bottom:\s*auto;[\s\S]*?\.super-assistant__panel\s*\{[\s\S]*?position:\s*fixed;/.test(css),
  'the compact assistant must move into the mobile header and open below it',
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

console.log('Responsive layout check passed: fluid narrow viewports, stable header breakpoint, bounded popovers, and compact assistant controls.');

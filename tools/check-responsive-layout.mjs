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
  'left: calc(1rem + env(safe-area-inset-left))',
  'min-height: min(24rem, calc(100svh - 7.5rem))',
  '@media (max-width: 360px)',
  'font-size: clamp(1.75rem, 13.5vw, 2.25rem)',
  'width: min(24rem, calc(100vw - 1.5rem))',
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

for (const requiredMarkup of [
  'aria-label="Open Super ii assistant"',
  'class="super-assistant__label"',
  'class="super-assistant__mascot"',
]) {
  assert(assistant.includes(requiredMarkup), `SuperAssistant.astro is missing ${requiredMarkup}`);
}

assert(siteScript.includes("matchMedia('(min-width: 1321px)')"), 'menu JavaScript breakpoint must match the CSS breakpoint');
assert(siteScript.includes('window.innerHeight - panelHeight - viewportPadding'), 'info popover positioning must clamp to the viewport');

console.log('Responsive layout check passed: fluid narrow viewports, stable header breakpoint, bounded popovers, and a persistent bottom-left assistant.');

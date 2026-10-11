import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };

const label = read('src/components/JourneyLabel.astro');
for (const kind of ['step', 'section', 'path', 'way', 'stage', 'rule', 'principle', 'level', 'rank', 'source', 'slot', 'connect', 'payment', 'item']) {
  expect(label.includes(`'${kind}'`), `JourneyLabel must support ${kind}.`);
}
expect(label.includes("locale === 'zh-CN'"), 'JourneyLabel must format Simplified Chinese directly.');
expect(label.includes("locale === 'ru'"), 'JourneyLabel must format Russian directly.');
expect(label.includes('data-no-translate'), 'JourneyLabel output must not be translated a second time by middleware.');

const requiredFiles = [
  'src/pages/index.astro',
  'src/pages/use.astro',
  'src/components/AgentStarter.astro',
  'src/components/AIWorkerStarter.astro',
  'src/components/ProductEditor.astro',
  'src/components/CreatorEditor.astro',
  'src/pages/bring-my-work.astro',
  'src/pages/frontier-ai.astro',
  'src/pages/robot/index.astro',
  'src/pages/social.astro',
  'src/pages/docs.astro',
  'src/pages/join-team.astro',
  'src/pages/system-state.astro',
  'src/pages/transparent/index.astro',
];
for (const path of requiredFiles) {
  expect(read(path).includes('JourneyLabel'), `${path} must use the shared semantic journey label.`);
}

const home = read('src/pages/index.astro');
expect(!home.includes('participation-home__number'), 'Home participation choices must not use decorative ordinal numbers.');

const usePage = read('src/pages/use.astro');
expect(usePage.includes('kind="path"') && usePage.includes('kind="step"'), 'Use page must distinguish choices from sequential steps.');
expect((usePage.match(/class="button pixel-action"/g) ?? []).length === 3, 'Use page must keep the pixel treatment on its three primary actions only.');

const css = read('src/styles/global.css');
for (const token of ['.button.pixel-action', '#007fa8', '#ffe23f', '#9a4dff', '#ff4aa6', '#ff842e', '#54e875']) {
  expect(css.includes(token), `Pixel action CSS is missing ${token}.`);
}
expect(css.includes('@media (max-width: 520px)'), 'Pixel actions must include a narrow-screen layout.');
expect(css.includes('@media (prefers-reduced-motion: reduce)'), 'Pixel actions must respect reduced motion.');
expect(css.includes('.journey-list'), 'Instructional lists must share a responsive semantic layout.');

const actionFiles = [
  'src/pages/use.astro',
  'src/pages/bring-my-work.astro',
  'src/pages/frontier-ai.astro',
  'src/pages/robot/index.astro',
  'src/pages/social.astro',
  'src/components/ProductEditor.astro',
  'src/components/CreatorEditor.astro',
];
for (const path of actionFiles) {
  const source = read(path);
  expect(!/<(?:button|a)[^>]*pixel-action[^>]*(?:data-copy|data-pause|data-remove|data-delete)/s.test(source), `${path} must not put the pixel style on utility or destructive actions.`);
}

if (failures.length) {
  console.error(`Journey UI validation failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}

console.log('Journey UI validation passed.');

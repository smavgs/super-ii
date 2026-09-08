#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFile(resolve(root, path), 'utf8');
const [catalogueSource, siteSource, middleware, layout, header, footer, styles, client, clerkLocale, sitemap, systemState, i18n, systemStateLocalization, notebookDocument, officialNotebookLocalization, buildShip, docs] = await Promise.all([
  read('src/content/locales/ru.json'),
  read('src/content/site.json'),
  read('src/middleware.ts'),
  read('src/layouts/BaseLayout.astro'),
  read('src/components/Header.astro'),
  read('src/components/Footer.astro'),
  read('src/styles/global.css'),
  read('public/scripts/localize-ru.js'),
  read('src/scripts/clerk-locale.ts'),
  read('public/sitemap.xml'),
  read('SYSTEM-STATE.md'),
  read('src/lib/i18n.ts'),
  read('src/lib/system-state-localization.ts'),
  read('src/components/NotebookDocument.astro'),
  read('src/lib/official-notebook-localization.ts'),
  read('src/components/BuildShip.astro'),
  read('src/pages/docs.astro'),
]);

const errors = [];
let catalogue;
let site;
try { catalogue = JSON.parse(catalogueSource); } catch { errors.push('Russian catalogue is not valid JSON'); }
try { site = JSON.parse(siteSource); } catch { errors.push('site.json is not valid JSON'); }

const messages = catalogue?.messages ?? {};
const entries = Object.entries(messages);
if (catalogue?.locale !== 'ru' || catalogue?.sourceLocale !== 'en') errors.push('Russian catalogue locale metadata is invalid');
if (entries.length < 2_700) errors.push(`Russian catalogue is unexpectedly small (${entries.length} messages)`);
if (entries.filter(([, value]) => /[А-Яа-яЁё]/.test(String(value))).length < 2_600) {
  errors.push('Russian catalogue does not contain enough Cyrillic translations');
}
if (entries.some(([, value]) => String(value).includes('908771'))) {
  errors.push('Russian catalogue contains an unresolved translation placeholder');
}

const digits = (value) => String(value).match(/\d+/g) ?? [];
const unsafeGeneratedEntries = entries.filter(([source, translation]) => {
  const sourceDigits = digits(source);
  const translationDigits = digits(translation);
  return sourceDigits.length !== translationDigits.length
    || sourceDigits.some((token, index) => token !== translationDigits[index]);
});
if (!i18n.includes('preservesNumericTokens(source, translation)')
  || !i18n.includes('.filter(([source, translation]) => preservesNumericTokens(source, translation))')) {
  errors.push('Generated Russian translations are not guarded against changed numeric facts');
}

const exact = {
  Models: 'Модели',
  Datasets: 'Наборы данных',
  Apps: 'Приложения',
  Skills: 'Навыки',
  Agents: 'Агенты',
  Builders: 'Создатели',
  Pricing: 'Тарифы',
  Workspace: 'Рабочее пространство',
  'Join free': 'Присоединиться бесплатно',
  'Checking the web…': 'Ищем в интернете…',
  'Close navigation': 'Закрыть навигацию',
  'Commerce token could not be created.': 'Не удалось создать токен для покупок.',
};
for (const [english, russian] of Object.entries(exact)) {
  if (messages[english] !== russian) errors.push(`Core translation is missing or changed: ${english}`);
}

const languages = site?.languages ?? [];
if (!languages.some((item) => item.code === 'en' && item.default === true && item.status === 'production')) {
  errors.push('English must remain the production default language');
}
if (!languages.some((item) => item.code === 'ru' && item.prefix === '/ru' && item.status === 'production')) {
  errors.push('Russian /ru production language declaration is missing');
}

const contracts = [
  [middleware, '${localeCookie}=ru', 'locale cookie'],
  [middleware, "context.locals.localizedRewrite", 'Russian route rewrite'],
  [middleware, "content-language", 'Content-Language response'],
  [middleware, "hreflang=\"ru\"", 'Russian hreflang metadata'],
  [middleware, "translateTextChunk", 'server-rendered text localization'],
  [middleware, "voidElements.has(element.tagName.toLowerCase())", 'void-element translation exclusion safety'],
  [middleware, "form[action]", 'localized form navigation'],
  [middleware, "'https://superii.site'", 'fixed canonical origin'],
  [layout, '/scripts/localize-ru.js', 'dynamic UI localizer'],
  [header, 'class="brand-lockup" href="/" aria-label="Super ii home" data-no-translate', 'untranslated header brand'],
  [footer, 'data-language-switch="ru"', 'footer language switch'],
  [footer, 'rel="me external" data-no-translate', 'untranslated social handle'],
  [styles, "html[data-locale='ru'] .desktop-nav", 'Russian desktop navigation breakpoint'],
  [client, 'MutationObserver', 'dynamic content localization'],
  [client, "record.type === 'characterData'", 'dynamic text replacement localization'],
  [client, "new Set(['/api', '/locales', '/.well-known', '/mcp', '/checkout/api'])", 'machine-route link protection'],
  [client, "x-superii-locale", 'localized client requests'],
  [client, '/locales/ru.json?v=20260908-8', 'current Russian catalogue cache key'],
  [clerkLocale, 'ruRU', 'Clerk Russian localization'],
  [sitemap, '<loc>https://superii.site/ru</loc>', 'Russian sitemap root'],
  [sitemap, '<loc>https://superii.site/ru/legal/terms</loc>', 'Russian legal sitemap route'],
  [sitemap, '<loc>https://superii.site/ru/social</loc>', 'Russian Social sitemap route'],
  [sitemap, '<loc>https://superii.site/ru/join-team</loc>', 'Russian Join Team sitemap route'],
  [sitemap, '<loc>https://superii.site/ru/build</loc>', 'Russian Build and Ship sitemap route'],
  [systemState, 'English and Russian product editions', 'localization system-state record'],
  [i18n, 'Hashing (.+)…', 'localized variable upload progress'],
  [i18n, 'Payment status:', 'localized variable payment status'],
  [i18n, "'Super ii Python SDK': 'SDK Super ii для Python'", 'reviewed Python SDK name'],
  [i18n, "'USDC on Ethereum': 'USDC в сети Ethereum'", 'reviewed USDC network name'],
  [i18n, "'App': 'Приложение'", 'reviewed App term'],
  [i18n, "'The': ''", 'Russian article-fragment removal'],
  [i18n, "'build',", 'localizable Build and Ship route'],
  [i18n, 'const buildShipRussian', 'reviewed Build and Ship translations'],
  [systemStateLocalization, 'russianSystemStateCount', 'explicit Russian system-state coverage'],
  [systemStateLocalization, "'Build & Ship engineering projects': {", 'Russian Build and Ship system-state row'],
  [systemStateLocalization, 'superii-sdk 0.2.0 в PyPI', 'current Russian SDK system-state evidence'],
  [systemStateLocalization, 'настроены точные издатели приватных фикстур', 'current Russian GitHub publisher evidence'],
  [notebookDocument, 'localizeOfficialNotebookMarkdown', 'official notebook localization boundary'],
  [notebookDocument, 'data-no-translate', 'publisher notebook source-language boundary'],
  [officialNotebookLocalization, 'localizeOfficialNotebookMarkdown', 'reviewed official notebook prose'],
  [buildShip, "document.documentElement.lang === 'ru'", 'locale-aware Build and Ship dynamic messages'],
  [buildShip, 'data-build-file data-no-translate', 'untranslated generated project filenames'],
  [docs, "const russian = Astro.locals.locale === 'ru'", 'reviewed Build and Ship documentation boundary'],
  [docs, 'Используйте точный формат subject', 'reviewed Russian GitHub OIDC documentation'],
];
for (const [source, marker, label] of contracts) {
  if (!source.includes(marker)) errors.push(`Localization contract is missing ${label}`);
}

const capabilitySection = systemState.split('## Capability register')[1]?.split('\n## ')[0] ?? '';
const canonicalCapabilityCount = capabilitySection
  .split('\n')
  .filter((line) => /^\|/.test(line.trim()))
  .slice(2)
  .filter((line) => line.split('|').length >= 6)
  .length;
const russianCapabilityCount = (systemStateLocalization.match(/^  ['"].+['"]: \{$/gm) ?? []).length;
if (canonicalCapabilityCount !== 49) errors.push(`Canonical system-state register has ${canonicalCapabilityCount} rows instead of 49`);
if (russianCapabilityCount !== canonicalCapabilityCount) {
  errors.push(`Russian system-state coverage is ${russianCapabilityCount}/${canonicalCapabilityCount}`);
}

if (errors.length) {
  for (const error of errors) console.error(`ERROR: ${error}`);
  process.exit(1);
}

console.log(`OK: Russian /ru edition validated with ${entries.length} stored UI translations, ${unsafeGeneratedEntries.length} unsafe machine entries rejected, and ${russianCapabilityCount} reviewed system-state rows`);

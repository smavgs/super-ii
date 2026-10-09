#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFile(resolve(root, path), 'utf8');
const files = await Promise.all([
  read('src/content/locales/ru.json'),
  read('src/content/locales/zh-CN.json'),
  read('src/content/site.json'),
  read('src/middleware.ts'),
  read('src/layouts/BaseLayout.astro'),
  read('src/components/Header.astro'),
  read('src/components/Footer.astro'),
  read('public/scripts/localize-ru.js'),
  read('public/scripts/localize-zh-cn.js'),
  read('src/scripts/clerk-locale.ts'),
  read('public/sitemap.xml'),
  read('SYSTEM-STATE.md'),
  read('src/lib/i18n.ts'),
  read('src/lib/system-state-localization.ts'),
  read('src/components/NotebookDocument.astro'),
  read('src/lib/official-notebook-localization.ts'),
  read('src/pages/tokenizer.astro'),
]);
const [ruSource, zhSource, siteSource, middleware, layout, header, footer, ruClient, zhClient, clerkLocale, sitemap, systemState, i18n, systemStateLocalization, notebookDocument, officialNotebookLocalization, tokenizerPage] = files;

const errors = [];
for (const routeRoot of ['products', 'workspace']) {
  if (!i18n.includes(`  '${routeRoot}',`)) errors.push(`Company product locale root is missing: ${routeRoot}`);
}
const parse = (source, label) => {
  try { return JSON.parse(source); }
  catch { errors.push(`${label} is not valid JSON`); return {}; }
};
const ru = parse(ruSource, 'Russian catalogue');
const zh = parse(zhSource, 'Simplified Chinese catalogue');
const site = parse(siteSource, 'site.json');

const digits = (value) => String(value).match(/\d+/g) ?? [];
const unsafeEntries = (catalogue) => Object.entries(catalogue.messages ?? {}).filter(([source, translation]) => {
  const sourceDigits = digits(source);
  const translationDigits = digits(translation);
  return sourceDigits.length !== translationDigits.length
    || sourceDigits.some((token, index) => token !== translationDigits[index]);
});

const ruEntries = Object.entries(ru.messages ?? {});
const zhEntries = Object.entries(zh.messages ?? {});
if (ru.locale !== 'ru' || ru.sourceLocale !== 'en') errors.push('Russian catalogue locale metadata is invalid');
if (zh.locale !== 'zh-CN' || zh.sourceLocale !== 'en') errors.push('Simplified Chinese catalogue locale metadata is invalid');
if (ruEntries.length < 2_700) errors.push(`Russian catalogue is unexpectedly small (${ruEntries.length} messages)`);
if (zhEntries.length < 4_800) errors.push(`Simplified Chinese catalogue is unexpectedly small (${zhEntries.length} messages)`);
if (ruEntries.filter(([, value]) => /[А-Яа-яЁё]/.test(String(value))).length < 2_600) errors.push('Russian catalogue does not contain enough Cyrillic translations');
if (zhEntries.filter(([, value]) => /[\u3400-\u9fff]/u.test(String(value))).length < 4_200) errors.push('Simplified Chinese catalogue does not contain enough Han-script translations');
if (ruEntries.some(([, value]) => String(value).includes('908771')) || zhEntries.some(([, value]) => String(value).includes('908771'))) errors.push('A locale catalogue contains an unresolved placeholder');

const unsafeRussian = unsafeEntries(ru);
const unsafeChinese = unsafeEntries(zh);
for (const marker of [
  'Object.entries((russianCatalog as { messages: Record<string, string> }).messages)',
  'Object.entries((chineseCatalog as { messages: Record<string, string> }).messages)',
  '.filter(([source, translation]) => preservesNumericTokens(source, translation))',
]) if (!i18n.includes(marker)) errors.push(`Numeric-fact guard is missing: ${marker}`);

const exactRussian = {
  Models: 'Модели', Datasets: 'Наборы данных', Apps: 'Приложения', Skills: 'Навыки',
  Agents: 'Агенты', Builders: 'Создатели', Pricing: 'Тарифы', Workspace: 'Рабочее пространство',
  'Join free': 'Присоединиться бесплатно', 'Checking the web…': 'Ищем в интернете…',
  'Close navigation': 'Закрыть навигацию',
};
for (const [english, translation] of Object.entries(exactRussian)) {
  if (ru.messages?.[english] !== translation) errors.push(`Core Russian translation is missing or changed: ${english}`);
}
const exactChinese = {
  'Agent Friendly': '对智能体友好',
  'Open super intelligence, built together.': '开放超级智能，共同构建。',
  Models: '模型', Datasets: '数据集', Apps: '应用', Skills: '技能', Builders: '创作者', Pricing: '定价',
  Workspace: '工作区', 'Join free': '免费加入', 'Checking the web…': '正在搜索网络…',
  'Close navigation': '关闭导航',
  'Finding verified tokenizer models…': '正在查找已验证的分词器模型…',
  'No verified tokenizer model matched that search.': '没有与该搜索匹配的已验证分词器模型。',
  'Model search is unavailable.': '模型搜索当前不可用。',
};
for (const [english, translation] of Object.entries(exactChinese)) {
  const reviewedMarker = `'${english.replaceAll("'", "\\'")}': '${translation.replaceAll("'", "\\'")}'`;
  if (zh.messages?.[english] !== translation && !i18n.includes(reviewedMarker)) errors.push(`Core Simplified Chinese translation is missing or changed: ${english}`);
}

const languages = site.languages ?? [];
if (!languages.some((item) => item.code === 'en' && item.default === true && item.status === 'production')) errors.push('English must remain the production default language');
if (!languages.some((item) => item.code === 'ru' && item.prefix === '/ru' && item.status === 'production')) errors.push('Russian /ru production language declaration is missing');
if (!languages.some((item) => item.code === 'zh-CN' && item.prefix === '/zh-cn' && item.status === 'production')) errors.push('Simplified Chinese /zh-cn production language declaration is missing');

const contracts = [
  [middleware, 'supportedLocales.includes', 'validated locale selection'],
  [middleware, 'context.locals.localizedRewrite', 'localized route rewrite'],
  [middleware, 'content-language', 'Content-Language response'],
  [middleware, 'hreflang="zh-CN"', 'Simplified Chinese hreflang metadata'],
  [middleware, "if (locale === 'en') return rewriter.transform(secured)", 'bounded English HTML rewrite'],
  [middleware, 'translateTextChunk', 'server-rendered text localization'],
  [middleware, 'voidElements.has(element.tagName.toLowerCase())', 'void-element translation safety'],
  [middleware, 'form[action]', 'localized form navigation'],
  [middleware, 'openGraphLocale(locale)', 'localized Open Graph locale'],
  [layout, '/scripts/localize-ru.js', 'Russian dynamic UI localizer'],
  [layout, '/scripts/localize-zh-cn.js', 'Simplified Chinese dynamic UI localizer'],
  [layout, '/brand/super-ii-social-card-zh-cn-si.png', 'Simplified Chinese share card'],
  [header, 'class="brand-lockup" href="/" aria-label="Super ii home" data-no-translate', 'untranslated header brand'],
  [footer, "'zh-CN': { label: '简体中文'", 'Simplified Chinese footer language choice'],
  [footer, "'zh-CN': ['en', 'ru']", 'Chinese-page alternate language order'],
  [footer, 'data-language-switch={targetLocale}', 'explicit footer language switching'],
  [ruClient, 'MutationObserver', 'Russian dynamic content localization'],
  [zhClient, 'MutationObserver', 'Chinese dynamic content localization'],
  [zhClient, "headers.set('x-superii-locale', 'zh-CN')", 'Chinese localized client requests'],
  [layout, '/scripts/localize-zh-cn.js?v=20261009-1', 'current Chinese localizer cache key'],
  [zhClient, '/locales/zh-cn.json?v=20261009-1', 'current Chinese catalogue cache key'],
  [zhClient, "value.match(/^(\\d+) verified models? ready\\.$/)", 'Chinese live tokenizer ready-count localization'],
  [zhClient, "value.match(/^(\\d+) verified models? found\\.$/)", 'Chinese live tokenizer result-count localization'],
  [i18n, "export type SiteLocale = 'en' | 'ru' | 'zh-CN'", 'three-locale type'],
  [i18n, "'robot',", 'localized Robot route'],
  [i18n, "'transparent',", 'localized Transparent route'],
  [i18n, 'translateChineseDynamic', 'Chinese dynamic-value localization'],
  [i18n, "normalized.match(/^(\\d+) verified models? ready\\.$/)", 'server-rendered Chinese tokenizer ready count'],
  [i18n, "normalized.match(/^(\\d+) verified models? found\\.$/)", 'server-rendered Chinese tokenizer result count'],
  [clerkLocale, 'ruRU, zhCN', 'Russian and Chinese Clerk localization'],
  [sitemap, '<loc>https://superii.site/ru/robot</loc>', 'Russian Robot sitemap route'],
  [sitemap, '<loc>https://superii.site/zh-cn</loc>', 'Chinese sitemap root'],
  [sitemap, '<loc>https://superii.site/zh-cn/legal/terms</loc>', 'Chinese legal sitemap route'],
  [sitemap, '<loc>https://superii.site/zh-cn/transparent</loc>', 'Chinese Transparent sitemap route'],
  [systemState, 'English, Russian, and Simplified Chinese product editions', 'three-edition system-state record'],
  [systemState, '| English, Russian, and Simplified Chinese product editions | production | English, Russian, and Simplified Chinese live |', 'live three-edition system-state record'],
  [systemStateLocalization, 'английская, русская и китайская версии работают', 'live three-edition Russian system-state record'],
  [systemStateLocalization, 'statusChinese', 'Chinese system-state status labels'],
  [systemStateLocalization, 'translateKnown(item.evidence, locale)', 'Chinese system-state evidence localization'],
  [notebookDocument, 'localizeOfficialNotebookMarkdown', 'official notebook localization boundary'],
  [notebookDocument, 'data-no-translate', 'publisher notebook source-language boundary'],
  [officialNotebookLocalization, "if (locale === 'zh-CN')", 'Simplified Chinese official notebook prose'],
  [tokenizerPage, "verified model${initial.items.length === 1 ? '' : 's'} ready.", 'tokenizer initial verified-model count source'],
  [tokenizerPage, "verified model${models.length === 1 ? '' : 's'} found.", 'tokenizer searched verified-model count source'],
  [tokenizerPage, "throw new Error('Model search is unavailable.')", 'tokenizer UI does not expose machine-error details'],
];
for (const [source, marker, label] of contracts) if (!source.includes(marker)) errors.push(`Localization contract is missing ${label}`);

for (const stale of [
  'English and Russian live; Simplified Chinese release candidate',
  'English live; Russian and Simplified Chinese release candidates',
]) {
  if (systemState.includes(stale)) errors.push(`Canonical System State still contains stale Chinese release-candidate language: ${stale}`);
  if (Object.hasOwn(zh.messages ?? {}, stale)) errors.push(`Simplified Chinese catalogue still contains stale release-candidate language: ${stale}`);
}

const capabilitySection = systemState.split('## Capability register')[1]?.split('\n## ')[0] ?? '';
const capabilityRows = capabilitySection.split('\n').filter((line) => /^\|/.test(line.trim())).slice(2);
const canonicalCapabilityCount = capabilityRows.filter((line) => line.split('|').length >= 6).length;
const russianCapabilityCount = (systemStateLocalization.match(/^  ['"].+['"]: \{$/gm) ?? []).length;
const chineseProductLabels = new Set(['Python SDK', 'Super ii Robot', 'Super ii Transparent']);
if (canonicalCapabilityCount !== 59) errors.push(`Canonical system-state register has ${canonicalCapabilityCount} rows instead of 59`);
if (russianCapabilityCount !== canonicalCapabilityCount) errors.push(`Russian system-state coverage is ${russianCapabilityCount}/${canonicalCapabilityCount}`);
for (const row of capabilityRows) {
  const cells = row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim().replaceAll('`', ''));
  if (cells[0] && !systemStateLocalization.includes(`  '${cells[0]}': {`) && !systemStateLocalization.includes(`  "${cells[0]}": {`)) {
    errors.push(`Russian system-state translation is missing: ${cells[0].slice(0, 90)}`);
  }
  for (const text of [cells[0], cells[2], cells[3]]) {
    if (text && !chineseProductLabels.has(text) && (!zh.messages?.[text] || !/[\u3400-\u9fff]/u.test(zh.messages[text]))) errors.push(`Chinese system-state translation is missing: ${text.slice(0, 90)}`);
  }
}

if (errors.length) {
  for (const error of errors) console.error(`ERROR: ${error}`);
  process.exit(1);
}

console.log(`OK: /ru and /zh-cn editions validated with ${ruEntries.length} Russian and ${zhEntries.length} Chinese UI translations; ${unsafeRussian.length + unsafeChinese.length} unsafe generated numeric entries are rejected at runtime; ${canonicalCapabilityCount} system-state rows covered`);

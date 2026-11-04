import type { Skill, SkillVariable, SkillsCatalog } from '@/lib/skills';
import { launchTargets, planSkillLaunch, dispatchSkillLaunch, type LaunchGroup, type LaunchTarget } from '@/lib/skill-launch';
import {
  siApple,
  siCursor,
  siDeepseek,
  siDiscord,
  siDropbox,
  siFigma,
  siGmail,
  siGithub,
  siGithubactions,
  siGoogleads,
  siGoogleanalytics,
  siGooglecalendar,
  siGoogledocs,
  siGoogledrive,
  siGooglegemini,
  siGooglesearchconsole,
  siGooglesheets,
  siGoogleslides,
  siHuggingface,
  siHubspot,
  siInstagram,
  siIntercom,
  siLinear,
  siMetaai,
  siNetlify,
  siNotion,
  siPerplexity,
  siPi,
  siPoe,
  siReddit,
  siStripe,
  siTiktok,
  siVercel,
  siWebflow,
  siX,
  siYoutube,
  siZendesk,
  siZoom,
} from 'simple-icons';

const glyphs: Record<string, string> = {
  marketing: '✦',
  ops: '⌘',
  personal: '◡',
  productivity: '↗',
  sales: '◆',
  success: '◎',
  'data science': '∿',
  'vibe coding': '⌁',
};

const russian = document.documentElement.lang === 'ru';
const chinese = document.documentElement.lang === 'zh-CN';
const languagePrefix = russian ? '/ru' : chinese ? '/zh-cn' : '';
const categoryRussian: Record<string, string> = {
  All: 'Все',
  Marketing: 'Маркетинг',
  Ops: 'Операции',
  Personal: 'Личное',
  Productivity: 'Продуктивность',
  Sales: 'Продажи',
  Success: 'Работа с клиентами',
  'Data Science': 'Анализ данных',
  'Vibe Coding': 'Разработка',
  'Work & Operations': 'Работа и операции',
  'Software & DevOps': 'Разработка и DevOps',
  'Sales, Marketing & Support': 'Продажи, маркетинг и поддержка',
  'Life Admin & Home': 'Быт и дом',
  'Money, Bills & Benefits': 'Финансы, счета и льготы',
  'Research & Knowledge': 'Исследования и знания',
  'Travel & Bookings': 'Путешествия и бронирования',
  'Shopping & Errands': 'Покупки и поручения',
  'Content & Creative': 'Контент и творчество',
  'Games & Simulations': 'Игры и симуляции',
  'Security, Science & Hardware': 'Безопасность, наука и оборудование',
};
const categoryChinese: Record<string, string> = {
  All: '全部', Marketing: '营销', Ops: '运营', Personal: '个人', Productivity: '效率', Sales: '销售', Success: '客户成功',
  'Data Science': '数据科学', 'Vibe Coding': '编程',
  'Work & Operations': '工作与运营', 'Software & DevOps': '软件与 DevOps',
  'Sales, Marketing & Support': '销售、营销与支持', 'Life Admin & Home': '日常事务与家庭',
  'Money, Bills & Benefits': '资金、账单与福利', 'Research & Knowledge': '研究与知识',
  'Travel & Bookings': '旅行与预订', 'Shopping & Errands': '购物与跑腿', 'Content & Creative': '内容与创意',
  'Games & Simulations': '游戏与模拟', 'Security, Science & Hardware': '安全、科学与硬件',
};
const chineseUi: Record<string, string> = {
  'Use your AI tool': '使用您的 AI 工具', 'First get': '先连接', 'Best with': '推荐搭配',
  'Desktop app': '桌面应用', 'Copy + open': '复制并打开', 'Open with prompt': '携带提示词打开',
  'Source': '来源', 'Recent': '最近使用', 'Your AI tool': '您的 AI 工具',
};

const LAST_TARGET_KEY = 'superii.skills.last-play-target.v1';
const SKILLS_PAGE_SIZE = 48;

const programAssets: Record<string, string> = {
  chatgpt: '/brand/agents/codex.svg',
  claude: '/brand/agents/claude-code.svg',
  'claude code': '/brand/agents/claude-code.svg',
  codex: '/brand/agents/codex.svg',
  'codex cli': '/brand/agents/codex.svg',
  copilot: '/brand/agents/copilot.svg',
  'github copilot': '/brand/agents/copilot.svg',
  grok: '/brand/agents/grok.svg',
  'grok agent': '/brand/agents/grok.svg',
  'grok agents': '/brand/agents/grok.svg',
  mistral: '/brand/agents/mistral.svg',
  opencode: '/brand/agents/opencode.svg',
  kimi: '/brand/agents/kimi.svg',
};

type ProgramSimpleIcon = { path: string; hex: string };
const programSimpleIcons: Record<string, ProgramSimpleIcon> = {
  apple: siApple,
  cursor: siCursor,
  deepseek: siDeepseek,
  discord: siDiscord,
  dropbox: siDropbox,
  figma: siFigma,
  gemini: siGooglegemini,
  gmail: siGmail,
  github: siGithub,
  'github actions': siGithubactions,
  'google ads': siGoogleads,
  'google analytics': siGoogleanalytics,
  'google calendar': siGooglecalendar,
  'google docs': siGoogledocs,
  'google drive': siGoogledrive,
  'google search console': siGooglesearchconsole,
  'search console': siGooglesearchconsole,
  'google sheets': siGooglesheets,
  'google slides': siGoogleslides,
  huggingchat: siHuggingface,
  'hugging face': siHuggingface,
  hubspot: siHubspot,
  instagram: siInstagram,
  intercom: siIntercom,
  linear: siLinear,
  meta: siMetaai,
  'meta ai': siMetaai,
  netlify: siNetlify,
  notion: siNotion,
  perplexity: siPerplexity,
  pi: siPi,
  poe: siPoe,
  reddit: siReddit,
  stripe: siStripe,
  tiktok: siTiktok,
  v0: siVercel,
  webflow: siWebflow,
  x: siX,
  youtube: siYoutube,
  zendesk: siZendesk,
  zoom: siZoom,
};

const programMonograms: Record<string, { copy: string; color: string }> = {
  ai2sql: { copy: 'AI', color: '#6c5ce7' },
  bolt: { copy: 'B', color: '#1389fd' },
  'ai tuber': { copy: 'AI', color: '#7c3aed' },
  aituber: { copy: 'AI', color: '#7c3aed' },
  gong: { copy: 'G', color: '#e63757' },
  goose: { copy: 'G', color: '#f97316' },
  granola: { copy: 'G', color: '#6c5ce7' },
  lovable: { copy: 'L', color: '#ed4a82' },
  manus: { copy: 'M', color: '#111111' },
  phind: { copy: 'P', color: '#4f46e5' },
  quickbooks: { copy: 'QB', color: '#2ca01c' },
  soundcheck: { copy: 'S', color: '#f97316' },
  transcriptapi: { copy: 'T', color: '#2563eb' },
  vscode: { copy: '<>', color: '#007acc' },
  'vscode insiders': { copy: '<>', color: '#24bfa5' },
  'vscode-insiders': { copy: '<>', color: '#24bfa5' },
  you: { copy: 'YOU', color: '#111111' },
  'you.com': { copy: 'YOU', color: '#111111' },
};

const programGlyphColors: Record<string, string> = {
  amazon: '#ff9900',
  linkedin: '#0a66c2',
  outlook: '#0078d4',
  salesforce: '#00a1e0',
  slack: '#4a154b',
};

const programIcons: Record<string, string> = {
  amazon: 'ph-amazon-logo',
  apple: 'ph-apple-logo',
  chatgpt: 'ph-open-ai-logo',
  discord: 'ph-discord-logo',
  dropbox: 'ph-dropbox-logo',
  figma: 'ph-figma-logo',
  github: 'ph-github-logo',
  'github actions': 'ph-github-logo',
  'google drive': 'ph-google-drive-logo',
  instagram: 'ph-instagram-logo',
  linkedin: 'ph-linkedin-logo',
  notion: 'ph-notion-logo',
  reddit: 'ph-reddit-logo',
  slack: 'ph-slack-logo',
  stripe: 'ph-stripe-logo',
  tiktok: 'ph-tiktok-logo',
  x: 'ph-x-logo',
  youtube: 'ph-youtube-logo',
};

function ui(english: string, russianText: string) {
  return russian ? russianText : chinese ? chineseUi[english] ?? english : english;
}

function categoryLabel(category: string) {
  return russian ? categoryRussian[category] ?? category : chinese ? categoryChinese[category] ?? category : category;
}

function required<T extends Element>(selector: string): T {
  const element = document.querySelector(selector);
  if (!element) throw new Error(`Skills interface is missing ${selector}`);
  return element as T;
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isSkillVariable(value: unknown): value is SkillVariable {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const variable = value as Record<string, unknown>;
  return typeof variable.name === 'string' && typeof variable.default === 'string';
}

function isSkill(value: unknown): value is Skill {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const skill = value as Record<string, unknown>;
  return typeof skill.slug === 'string'
    && typeof skill.name === 'string'
    && typeof skill.category === 'string'
    && typeof skill.prompt === 'string'
    && isStringList(skill.integrations)
    && (skill.summary === undefined || typeof skill.summary === 'string')
    && (skill.source === undefined || (typeof skill.source === 'object' && skill.source !== null
      && typeof (skill.source as { label?: unknown }).label === 'string'
      && typeof (skill.source as { url?: unknown }).url === 'string'
      && /^https:\/\//.test((skill.source as { url: string }).url)))
    && (skill.tags === undefined || isStringList(skill.tags))
    && (skill.bestWith === undefined || isStringList(skill.bestWith))
    && (skill.variables === undefined
      || (Array.isArray(skill.variables) && skill.variables.every(isSkillVariable)));
}

function parseCatalog(value: unknown): SkillsCatalog | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const catalog = value as Record<string, unknown>;
  if (catalog.version !== 1 || !Array.isArray(catalog.skills) || !catalog.skills.every(isSkill)) return null;
  return catalog as SkillsCatalog;
}

function glyph(category: string) {
  return glyphs[category.toLocaleLowerCase()] ?? '✦';
}

function summary(prompt: string) {
  const copy = prompt.replace(/\s+/g, ' ').trim();
  const sentence = copy.match(/^.{24,150}?[.!?](?:\s|$)/)?.[0]?.trim() ?? copy;
  return sentence.length > 132 ? `${sentence.slice(0, 129).trimEnd()}…` : sentence;
}

function normalizeName(value: string) {
  return value.trim().toLocaleLowerCase();
}

function genericProgramIcon(name: string) {
  const value = normalizeName(name);
  if (/mail|email|smtp|dkim|dmarc|spf|gmail|outlook/.test(value)) return 'ph-envelope-simple';
  if (/calendar|booking|flight|aviation/.test(value)) return 'ph-calendar-blank';
  if (/drive|folder|file|notes|docs|cms|content management/.test(value)) return 'ph-file';
  if (/database|data|sql|analytics|search console/.test(value)) return 'ph-database';
  if (/github|\bgit\b/.test(value)) return 'ph-github-logo';
  if (/cloud|remote vm|hosting/.test(value)) return 'ph-cloud';
  if (/search|web|news|website|browser/.test(value)) return 'ph-globe';
  if (/video|youtube|tiktok|capcut/.test(value)) return 'ph-video';
  if (/photo|image|figma|blender|manim/.test(value)) return 'ph-image';
  if (/chat|discord|message|slack|intercom/.test(value)) return 'ph-chats';
  return 'ph-plug';
}

function programMark(name: string, target?: LaunchTarget) {
  const wrapper = document.createElement('span');
  wrapper.className = 'program-mark';
  wrapper.setAttribute('aria-hidden', 'true');
  const normalized = normalizeName(name);
  const asset = target?.asset ?? programAssets[normalized];
  if (asset) {
    const image = document.createElement('img');
    image.src = asset;
    image.alt = '';
    image.loading = 'lazy';
    wrapper.appendChild(image);
    return wrapper;
  }
  const simple = programSimpleIcons[target?.id ?? ''] ?? programSimpleIcons[normalized];
  if (simple) {
    wrapper.classList.add('program-mark--brand');
    wrapper.style.setProperty('--program-brand', `#${simple.hex}`);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('focusable', 'false');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', simple.path);
    svg.appendChild(path);
    wrapper.appendChild(svg);
    return wrapper;
  }
  const monogram = programMonograms[target?.id ?? ''] ?? programMonograms[normalized];
  if (monogram) {
    wrapper.classList.add('program-mark--brand');
    wrapper.style.setProperty('--program-brand', monogram.color);
    const copy = document.createElement('b');
    copy.textContent = monogram.copy;
    wrapper.appendChild(copy);
    return wrapper;
  }
  const icon = document.createElement('i');
  const glyphColor = programGlyphColors[normalized];
  if (glyphColor) {
    wrapper.classList.add('program-mark--brand');
    wrapper.style.setProperty('--program-brand', glyphColor);
  }
  icon.className = `ph ${target?.icon ?? programIcons[normalized] ?? genericProgramIcon(name)}`;
  wrapper.appendChild(icon);
  return wrapper;
}

function requirementChip(name: string, bestWith = false) {
  const chip = document.createElement('span');
  chip.className = 'skill-requirement';
  chip.setAttribute('data-no-translate', '');
  chip.appendChild(programMark(name));
  const copy = document.createElement('span');
  copy.textContent = name;
  chip.appendChild(copy);
  if (bestWith) chip.classList.add('skill-requirement--model');
  return chip;
}

function requirementGroup(label: string, names: string[], bestWith = false) {
  const group = document.createElement('div');
  group.className = 'skill-requirement-group';
  const heading = document.createElement('b');
  heading.textContent = label;
  group.appendChild(heading);
  names.forEach((name) => group.appendChild(requirementChip(name, bestWith)));
  return group;
}

const search = required<HTMLInputElement>('[data-skills-search]');
const count = required<HTMLElement>('[data-skills-count]');
const filters = required<HTMLElement>('[data-skills-filters]');
const grid = required<HTMLElement>('[data-skills-grid]');
const pagination = required<HTMLElement>('[data-skills-pagination]');
const shown = required<HTMLElement>('[data-skills-shown]');
const more = required<HTMLButtonElement>('[data-skills-more]');
const dialogSource = required<HTMLElement>('[data-skill-window-source]');
const error = required<HTMLElement>('[data-skills-error]');
const retry = required<HTMLButtonElement>('[data-skills-retry]');
const empty = required<HTMLElement>('[data-skills-empty]');
const clear = required<HTMLButtonElement>('[data-skills-clear]');
const dialog = required<HTMLDialogElement>('[data-skill-window]');
const dialogTitle = required<HTMLElement>('[data-skill-window-title]');
const dialogCategory = required<HTMLElement>('[data-skill-window-category]');
const dialogMark = required<HTMLElement>('[data-skill-window-mark]');
const dialogRequirements = required<HTMLElement>('[data-skill-window-integrations]');
const dialogPrompt = required<HTMLElement>('[data-skill-window-prompt]');
const dialogStatus = required<HTMLElement>('[data-skill-window-status]');
const dialogClose = required<HTMLButtonElement>('[data-skill-window-close]');
const copyButton = required<HTMLButtonElement>('[data-skill-window-copy]');
const shareButton = required<HTMLButtonElement>('[data-skill-window-share]');
const playButton = required<HTMLButtonElement>('[data-skill-window-play]');

const launcher = required<HTMLDialogElement>('[data-skill-launcher]');
const launcherTitle = required<HTMLElement>('[data-skill-launcher-title]');
const launcherClose = required<HTMLButtonElement>('[data-skill-launcher-close]');
const launcherPicker = required<HTMLElement>('[data-skill-launcher-picker]');
const launcherList = required<HTMLElement>('[data-skill-launcher-list]');
const launcherRecent = required<HTMLElement>('[data-skill-launcher-recent]');
const launcherTabs = [...document.querySelectorAll<HTMLButtonElement>('[data-skill-launcher-tab]')];
const launcherVariables = required<HTMLFormElement>('[data-skill-launcher-variables]');
const launcherBack = required<HTMLButtonElement>('[data-skill-launcher-back]');
const launcherVariableTitle = required<HTMLElement>('[data-skill-launcher-variable-title]');
const launcherFields = required<HTMLElement>('[data-skill-launcher-fields]');
const launcherContinue = required<HTMLButtonElement>('[data-skill-launcher-continue]');
const launcherHandoff = required<HTMLElement>('[data-skill-launcher-handoff]');
const launcherHandoffTitle = required<HTMLElement>('[data-skill-launcher-handoff-title]');
const launcherHandoffCopy = required<HTMLElement>('[data-skill-launcher-handoff-copy]');
const launcherHandoffBack = required<HTMLButtonElement>('[data-skill-launcher-handoff-back]');
const launcherHandoffOpen = required<HTMLAnchorElement>('[data-skill-launcher-handoff-open]');

const handoffStatus = required<HTMLElement>('[data-skill-launcher-handoff-status]');
const handoffPrompt = required<HTMLTextAreaElement>('[data-skill-launcher-handoff-prompt]');
const handoffCopy = required<HTMLButtonElement>('[data-skill-launcher-handoff-copy-again]');

let skills: Skill[] = [];
let visibleLimit = SKILLS_PAGE_SIZE;
let activeCategory = 'All';
let activeSkill: Skill | null = null;
let activeLaunchTab: LaunchGroup = 'chat';
let pendingTarget: LaunchTarget | null = null;
let loading = false;

function searchable(skill: Skill) {
  return [
    skill.name,
    skill.category,
    skill.summary ?? '',
    ...skill.integrations,
    ...(skill.tags ?? []),
    ...(skill.bestWith ?? []),
    skill.prompt,
  ].join(' ').toLocaleLowerCase();
}

function visibleSkills() {
  const query = search.value.trim().toLocaleLowerCase();
  return skills.filter((skill) => (
    (activeCategory === 'All' || skill.category === activeCategory)
    && (!query || searchable(skill).includes(query))
  ));
}

function skillShareUrl(skill: Skill) {
  const url = new URL(`${languagePrefix}/skills`, document.baseURI);
  url.searchParams.set('skill', skill.slug);
  return url.toString();
}

function clearActionStatus(button: HTMLButtonElement, className: string) {
  window.setTimeout(() => {
    dialogStatus.textContent = '';
    button.classList.remove(className);
  }, 1_800);
}

function renderDialogRequirements(skill: Skill) {
  dialogRequirements.replaceChildren();
  if (skill.integrations.length) {
    dialogRequirements.appendChild(requirementGroup(ui('First get', 'Сначала подключите'), skill.integrations));
  } else {
    const ready = document.createElement('div');
    ready.className = 'skill-requirement-group skill-requirement-group--ready';
    const icon = document.createElement('i');
    icon.className = 'ph ph-check-circle';
    icon.setAttribute('aria-hidden', 'true');
    const copy = document.createElement('span');
    copy.textContent = ui('Use your AI tool', 'Используйте свой ИИ-инструмент');
    ready.appendChild(icon);
    ready.appendChild(copy);
    dialogRequirements.appendChild(ready);
  }
  if (skill.bestWith?.length) {
    dialogRequirements.appendChild(requirementGroup(ui('Best with', 'Лучше всего с'), skill.bestWith, true));
  }
}

function openSkill(skill: Skill) {
  activeSkill = skill;
  dialogTitle.setAttribute('data-no-translate', '');
  dialogPrompt.setAttribute('data-no-translate', '');
  dialogTitle.textContent = skill.name;
  dialogCategory.textContent = categoryLabel(skill.category);
  dialogMark.textContent = glyph(skill.category);
  dialogPrompt.textContent = skill.prompt;
  dialogSource.replaceChildren();
  dialogSource.hidden = !skill.source;
  if (skill.source) {
    const link = document.createElement('a');
    link.href = skill.source.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = `${ui('Source', 'Источник')}: ${skill.source.label} ↗`;
    dialogSource.appendChild(link);
  }
  dialogStatus.textContent = '';
  renderDialogRequirements(skill);
  document.body.classList.add('skill-window-open');
  dialog.showModal();
}

function cardRequirements(skill: Skill) {
  const row = document.createElement('span');
  row.className = 'skill-card__requirements';
  if (!skill.integrations.length) {
    const icon = document.createElement('i');
    icon.className = 'ph ph-check-circle';
    icon.setAttribute('aria-hidden', 'true');
    const copy = document.createElement('span');
    copy.textContent = ui('Use your AI tool', 'Используйте свой ИИ-инструмент');
    row.appendChild(icon);
    row.appendChild(copy);
    return row;
  }

  const label = document.createElement('span');
  label.textContent = ui('First get', 'Сначала');
  row.appendChild(label);
  skill.integrations.slice(0, 2).forEach((name) => {
    const item = document.createElement('span');
    item.setAttribute('data-no-translate', '');
    item.appendChild(programMark(name));
    const text = document.createElement('span');
    text.textContent = name;
    item.appendChild(text);
    row.appendChild(item);
  });
  if (skill.integrations.length > 2) {
    const more = document.createElement('small');
    more.textContent = `+${skill.integrations.length - 2}`;
    row.appendChild(more);
  }
  return row;
}

function makeCard(skill: Skill, index: number) {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'skill-card';
  card.setAttribute('data-no-translate', '');
  card.dataset.skillSlug = skill.slug;
  card.setAttribute('aria-label', russian ? `Открыть навык «${skill.name}»` : `Open ${skill.name} skill`);

  const top = document.createElement('span');
  top.className = 'skill-card__top';
  const mark = document.createElement('i');
  mark.setAttribute('aria-hidden', 'true');
  mark.textContent = glyph(skill.category);
  const number = document.createElement('small');
  number.textContent = `${russian ? 'Элемент' : chinese ? '项目' : 'Item'} ${String(index + 1).padStart(3, '0')}`;
  top.appendChild(mark);
  top.appendChild(number);

  const title = document.createElement('strong');
  title.textContent = skill.name;
  const copy = document.createElement('span');
  copy.className = 'skill-card__copy';
  copy.textContent = summary(skill.summary ?? skill.prompt);
  const meta = document.createElement('span');
  meta.className = 'skill-card__meta';
  const category = document.createElement('b');
  category.textContent = categoryLabel(skill.category);
  meta.appendChild(category);
  meta.appendChild(cardRequirements(skill));
  card.appendChild(top);
  card.appendChild(title);
  card.appendChild(copy);
  card.appendChild(meta);
  card.addEventListener('click', () => openSkill(skill));
  return card;
}

function renderCards(reset: unknown = true) {
  if (reset !== false) visibleLimit = SKILLS_PAGE_SIZE;
  const visible = visibleSkills();
  grid.replaceChildren(...visible.slice(0, visibleLimit).map(makeCard));
  pagination.hidden = visible.length === 0;
  more.hidden = visibleLimit >= visible.length;
  const displayed = Math.min(visible.length, visibleLimit);
  shown.textContent = chinese ? `已显示 ${displayed} / ${visible.length} 项` : ui(`Showing ${displayed} of ${visible.length}`, `Показано ${displayed} из ${visible.length}`);
  grid.classList.remove('skills-grid--loading');
  grid.setAttribute('aria-busy', 'false');
  empty.hidden = visible.length !== 0;
  grid.hidden = visible.length === 0;
  if (russian) {
    const mod10 = visible.length % 10;
    const mod100 = visible.length % 100;
    const noun = mod10 === 1 && mod100 !== 11
      ? 'навык'
      : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)
        ? 'навыка'
        : 'навыков';
    const suffix = activeCategory === 'All' ? '' : ` в категории «${categoryLabel(activeCategory)}»`;
    count.textContent = `${visible.length} ${noun}${suffix}`;
  } else if (chinese) {
    count.textContent = `${visible.length} 项技能${activeCategory === 'All' ? '' : ` · ${categoryLabel(activeCategory)}`}`;
  } else {
    const suffix = activeCategory === 'All' ? '' : ` in ${activeCategory}`;
    count.textContent = `${visible.length} ${visible.length === 1 ? 'skill' : 'skills'}${suffix}`;
  }
}

function renderFilters() {
  const categories = [...new Set(skills.map((skill) => skill.category))]
    .sort((left, right) => left.localeCompare(right));
  filters.replaceChildren();
  ['All', ...categories].forEach((category) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = categoryLabel(category);
    button.dataset.skillsCategory = category;
    button.setAttribute('aria-pressed', String(category === activeCategory));
    button.addEventListener('click', () => {
      activeCategory = category;
      filters.querySelectorAll('button').forEach((candidate) => {
        candidate.setAttribute('aria-pressed', String(candidate === button));
      });
      renderCards();
    });
    filters.appendChild(button);
  });
  filters.hidden = false;
}

async function loadSkills() {
  if (loading) return;
  loading = true;
  error.hidden = true;
  count.textContent = ui('Loading skills…', 'Загружаем навыки…');
  retry.disabled = true;
  try {
    // Give the expanded collection its own browser cache entry. Returning
    // visitors may still have the previous release's stale-while-revalidate copy.
    const response = await fetch('/api/skills?catalog=3', {
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
    });
    const catalog = parseCatalog(await response.json().catch(() => null));
    if (!response.ok || !catalog) throw new Error('catalog unavailable');
    skills = [...catalog.skills].sort((left, right) => left.name.localeCompare(right.name));
    renderFilters();
    renderCards();
    const requestedSlug = new URL(document.URL).searchParams.get('skill');
    const requestedSkill = requestedSlug
      ? skills.find((skill) => skill.slug === requestedSlug)
      : null;
    if (requestedSkill) openSkill(requestedSkill);
  } catch {
    grid.hidden = true;
    empty.hidden = true;
    error.hidden = false;
    count.textContent = ui('Skills unavailable', 'Навыки недоступны');
  } finally {
    loading = false;
    retry.disabled = false;
  }
}

function targetModeLabel(target: LaunchTarget) {
  if (target.mode === 'deeplink') return ui('Desktop app', 'Приложение');
  if (target.mode === 'copy') return ui('Copy + open', 'Копировать + открыть');
  return ui('Open with prompt', 'Открыть с промптом');
}

function readLastTarget() {
  try {
    return window.localStorage.getItem(LAST_TARGET_KEY);
  } catch {
    return null;
  }
}

function rememberTarget(target: LaunchTarget) {
  try {
    window.localStorage.setItem(LAST_TARGET_KEY, target.id);
  } catch {
    // A remembered target is optional; launching still works without storage.
  }
}

function targetButton(target: LaunchTarget) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'skill-launch-target';
  button.setAttribute('data-no-translate', '');
  button.appendChild(programMark(target.name, target));
  const copy = document.createElement('span');
  const name = document.createElement('strong');
  name.textContent = target.name;
  const behavior = document.createElement('small');
  behavior.textContent = targetModeLabel(target);
  copy.appendChild(name);
  copy.appendChild(behavior);
  const arrow = document.createElement('i');
  arrow.className = 'ph ph-arrow-up-right';
  arrow.setAttribute('aria-hidden', 'true');
  button.appendChild(copy);
  button.appendChild(arrow);
  button.addEventListener('click', () => selectTarget(target));
  return button;
}

function renderLaunchTargets() {
  const targets = launchTargets
    .filter((target) => target.group === activeLaunchTab)
    .sort((left, right) => left.name.localeCompare(right.name));
  const recentId = readLastTarget();
  const recentTarget = targets.find((target) => target.id === recentId);
  launcherRecent.replaceChildren();
  launcherRecent.hidden = !recentTarget;
  if (recentTarget) {
    const label = document.createElement('p');
    label.textContent = ui('Recent', 'Недавнее');
    launcherRecent.appendChild(label);
    launcherRecent.appendChild(targetButton(recentTarget));
  }
  launcherList.replaceChildren(...targets
    .filter((target) => target !== recentTarget)
    .map(targetButton));
  launcherTabs.forEach((button) => {
    const selected = button.dataset.skillLauncherTab === activeLaunchTab;
    button.setAttribute('aria-selected', String(selected));
  });
}

function resetLauncher() {
  pendingTarget = null;
  launcherPicker.hidden = false;
  launcherVariables.hidden = true;
  launcherHandoff.hidden = true;
  launcherFields.replaceChildren();
  launcherHandoffOpen.hidden = true;
  launcherHandoffOpen.removeAttribute('href');
  launcherTitle.textContent = ui('Your AI tool', 'Ваш ИИ-инструмент');
  renderLaunchTargets();
}

function positionLauncher() {
  launcher.style.removeProperty('--skill-launcher-top');
  launcher.style.removeProperty('--skill-launcher-left');
  if (window.matchMedia('(max-width: 620px)').matches) {
    launcher.dataset.placement = 'sheet';
    return;
  }
  const anchor = playButton.getBoundingClientRect();
  const width = launcher.offsetWidth;
  const height = launcher.offsetHeight;
  const gap = 10;
  const roomAbove = anchor.top;
  const roomBelow = window.innerHeight - anchor.bottom;
  const opensUp = roomAbove >= height + gap || roomAbove > roomBelow;
  const top = opensUp
    ? Math.max(8, anchor.top - height - gap)
    : Math.min(window.innerHeight - height - 8, anchor.bottom + gap);
  const left = Math.max(8, Math.min(anchor.right - width, window.innerWidth - width - 8));
  launcher.dataset.placement = opensUp ? 'up' : 'down';
  launcher.style.setProperty('--skill-launcher-top', `${top}px`);
  launcher.style.setProperty('--skill-launcher-left', `${left}px`);
}

function openLauncher() {
  if (!activeSkill) return;
  const recentTarget = launchTargets.find((target) => target.id === readLastTarget());
  activeLaunchTab = ['vibe coding', 'software & devops'].includes(normalizeName(activeSkill.category))
    ? 'code'
    : recentTarget?.group ?? 'chat';
  resetLauncher();
  launcher.showModal();
  window.requestAnimationFrame(positionLauncher);
}

function showVariableForm(target: LaunchTarget, variables: SkillVariable[]) {
  pendingTarget = target;
  launcherPicker.hidden = true;
  launcherHandoff.hidden = true;
  launcherVariables.hidden = false;
  launcherTitle.textContent = target.name;
  launcherVariableTitle.textContent = ui(`Before opening ${target.name}`, `Перед открытием ${target.name}`);
  launcherFields.replaceChildren(...variables.map((variable) => {
    const label = document.createElement('label');
    const title = document.createElement('span');
    title.textContent = `\${${variable.name}}`;
    const input = document.createElement('input');
    input.name = variable.name;
    input.value = variable.default;
    input.placeholder = variable.default || ui('Required', 'Обязательно');
    input.maxLength = 600;
    input.required = !variable.default;
    input.autocomplete = 'off';
    input.spellcheck = false;
    label.appendChild(title);
    label.appendChild(input);
    return label;
  }));
  const label = launcherContinue.querySelector('span');
  if (label) label.textContent = ui(`Open ${target.name}`, `Открыть ${target.name}`);
  launcherFields.querySelector('input')?.focus();
  window.requestAnimationFrame(positionLauncher);
}

function substituteVariables(skill: Skill, form: FormData) {
  let prompt = skill.prompt;
  for (const variable of skill.variables ?? []) {
    const value = String(form.get(variable.name) ?? '');
    const pattern = new RegExp(`\\$\\{${variable.name}(?::[^}]*)?\\}`, 'g');
    prompt = prompt.replace(pattern, () => value);
  }
  return prompt;
}

async function copyText(value: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Fall through to the selection-based clipboard fallback.
  }
  try {
    const field = document.createElement('textarea');
    field.value = value;
    field.setAttribute('readonly', '');
    field.style.position = 'fixed';
    field.style.opacity = '0';
    document.body.appendChild(field);
    field.select();
    const copied = document.execCommand('copy');
    field.remove();
    return copied;
  } catch {
    return false;
  }
}

function showHandoff(target: LaunchTarget, prompt: string, copied: boolean, plan: ReturnType<typeof planSkillLaunch>, blocked: boolean) {
  launcherPicker.hidden = true;
  launcherVariables.hidden = true;
  launcherHandoff.hidden = false;
  launcherTitle.textContent = target.name;
  handoffStatus.textContent = copied ? ui('Complete prompt copied', 'Полный промпт скопирован') : ui('Complete prompt ready', 'Полный промпт готов');
  handoffPrompt.value = prompt;
  launcherHandoffTitle.textContent = blocked
    ? ui('Allow the new tab, or open it below.', 'Разрешите новую вкладку или откройте ниже.')
    : plan.native
      ? ui('Continue in the Codex app.', 'Продолжите в приложении Codex.')
      : plan.requiresPaste
        ? ui(`Paste the skill in ${target.name}.`, `Вставьте навык в ${target.name}.`)
        : ui(`Continue in ${target.name}.`, `Продолжите в ${target.name}.`);
  launcherHandoffCopy.textContent = plan.native
    ? ui('The desktop app must be installed. You can also open Codex in your browser and paste the prompt.', 'Приложение должно быть установлено. Можно открыть Codex в браузере и вставить промпт.')
    : plan.reason === 'long'
      ? ui('The complete prompt is too long for a link. The tool still opens; paste the full text there.', 'Полный промпт слишком длинный для ссылки. Инструмент откроется; вставьте полный текст.')
      : ui('Sign in if needed. If the prompt is not already filled in, paste it. Review it before sending.', 'Войдите при необходимости. Если промпт не заполнен, вставьте его. Проверьте перед отправкой.');
  if (!copied) launcherHandoffCopy.textContent += ' ' + ui('Clipboard access was unavailable; copy the complete prompt below.', 'Буфер обмена недоступен; скопируйте полный промпт ниже.');
  launcherHandoffOpen.href = plan.native ? target.openUrl : plan.url;
  launcherHandoffOpen.textContent = plan.native
    ? ui('Open Codex in browser ↗', 'Открыть Codex в браузере ↗')
    : ui(`Open ${target.name} ↗`, `Открыть ${target.name} ↗`);
  launcherHandoffOpen.hidden = false;
  window.requestAnimationFrame(positionLauncher);
}

async function launchSkill(target: LaunchTarget, prompt: string) {
  if (!activeSkill) return;
  rememberTarget(target);
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
    || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  const { plan, blocked, copied } = await dispatchSkillLaunch(target, prompt, {
    copy: copyText,
    openNative: (url) => window.location.assign(url),
    open: (url) => {
      const opened = window.open('about:blank', '_blank');
      if (!opened) return false;
      opened.opener = null;
      opened.location.replace(url);
      return true;
    },
  }, mobile);
  showHandoff(target, prompt, copied, plan, blocked);
}

function selectTarget(target: LaunchTarget) {
  if (!activeSkill) return;
  const variables = activeSkill.variables ?? [];
  if (variables.length) {
    showVariableForm(target, variables);
    return;
  }
  void launchSkill(target, activeSkill.prompt);
}

more.addEventListener('click', () => {
  const previous = visibleLimit;
  visibleLimit += SKILLS_PAGE_SIZE;
  renderCards(false);
  (grid.children[previous] as HTMLElement | undefined)?.focus();
});
search.addEventListener('input', renderCards);
search.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && search.value) {
    search.value = '';
    renderCards();
  }
});
document.addEventListener('keydown', (event) => {
  if (event.key === '/' && document.activeElement !== search && !dialog.open && !launcher.open) {
    event.preventDefault();
    search.focus();
  }
});
retry.addEventListener('click', () => {
  grid.hidden = false;
  grid.classList.add('skills-grid--loading');
  grid.setAttribute('aria-busy', 'true');
  void loadSkills();
});
clear.addEventListener('click', () => {
  search.value = '';
  activeCategory = 'All';
  filters.querySelectorAll('button').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.getAttribute('data-skills-category') === 'All'));
  });
  renderCards();
  search.focus();
});
dialogClose.addEventListener('click', () => dialog.close());
dialog.addEventListener('click', (event) => {
  if (event.target === dialog) dialog.close();
});
dialog.addEventListener('close', () => {
  if (launcher.open) launcher.close();
  document.body.classList.remove('skill-window-open');
});
copyButton.addEventListener('click', async () => {
  if (!activeSkill) return;
  if (await copyText(activeSkill.prompt)) {
    dialogStatus.textContent = ui('Complete prompt copied.', 'Полный промпт скопирован.');
    copyButton.classList.add('is-copied');
    clearActionStatus(copyButton, 'is-copied');
  } else {
    dialogStatus.textContent = ui('Copy was blocked. Select the prompt manually.', 'Копирование заблокировано. Выделите промпт вручную.');
  }
});
shareButton.addEventListener('click', async () => {
  if (!activeSkill) return;
  const url = skillShareUrl(activeSkill);
  const shareData = {
    title: `${activeSkill.name} · Super ii Skills`,
    text: `${activeSkill.name} — a ready-to-use AI-agent skill on Super ii.`,
    url,
  };

  try {
    if (typeof navigator.share === 'function'
      && (typeof navigator.canShare !== 'function' || navigator.canShare(shareData))) {
      await navigator.share(shareData);
      dialogStatus.textContent = ui('Skill shared.', 'Навыком поделились.');
    } else {
      if (!(await copyText(url))) throw new Error('share unavailable');
      dialogStatus.textContent = ui('Share link copied.', 'Ссылка скопирована.');
    }
    shareButton.classList.add('is-shared');
    clearActionStatus(shareButton, 'is-shared');
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') return;
    if (await copyText(url)) {
      dialogStatus.textContent = ui('Share link copied.', 'Ссылка скопирована.');
      shareButton.classList.add('is-shared');
      clearActionStatus(shareButton, 'is-shared');
    } else {
      dialogStatus.textContent = ui('Sharing is unavailable. Copy the link from your browser.', 'Поделиться не удалось. Скопируйте ссылку из браузера.');
    }
  }
});
playButton.addEventListener('click', openLauncher);
launcherClose.addEventListener('click', () => launcher.close());
launcher.addEventListener('click', (event) => {
  if (event.target === launcher) launcher.close();
});
launcherTabs.forEach((button) => button.addEventListener('click', () => {
  activeLaunchTab = button.dataset.skillLauncherTab === 'code' ? 'code' : 'chat';
  renderLaunchTargets();
  window.requestAnimationFrame(positionLauncher);
}));
launcherBack.addEventListener('click', resetLauncher);
launcherHandoffBack.addEventListener('click', resetLauncher);
handoffCopy.addEventListener('click', async () => {
  const copied = await copyText(handoffPrompt.value);
  handoffStatus.textContent = copied ? ui('Complete prompt copied', 'Полный промпт скопирован') : ui('Select and copy the prompt below.', 'Выделите и скопируйте промпт ниже.');
  if (!copied) {
    handoffPrompt.closest('details')?.setAttribute('open', '');
    handoffPrompt.focus(); handoffPrompt.select();
  }
});
launcherVariables.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!activeSkill || !pendingTarget) return;
  const prompt = substituteVariables(activeSkill, new FormData(launcherVariables));
  void launchSkill(pendingTarget, prompt);
});
window.addEventListener('resize', () => {
  if (launcher.open) positionLauncher();
});

void loadSkills();

import type { Skill, SkillVariable, SkillsCatalog } from '@/lib/skills';

type LaunchGroup = 'chat' | 'code';
type LaunchMode = 'url' | 'copy' | 'deeplink';

type LaunchTarget = {
  id: string;
  name: string;
  group: LaunchGroup;
  mode: LaunchMode;
  icon?: string;
  asset?: string;
  openUrl?: string;
  makeUrl?: (prompt: string, skill: Skill) => string;
};

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
};

const DIRECT_PROMPT_LIMIT = 3_500;
const LAST_TARGET_KEY = 'superii.skills.last-play-target.v1';

const launchTargets: LaunchTarget[] = [
  { id: 'chatgpt', name: 'ChatGPT', group: 'chat', mode: 'url', icon: 'ph-open-ai-logo', openUrl: 'https://chatgpt.com/', makeUrl: (prompt) => `https://chatgpt.com/?q=${encodeURIComponent(prompt)}` },
  { id: 'claude', name: 'Claude', group: 'chat', mode: 'url', asset: '/brand/agents/claude-code.svg', openUrl: 'https://claude.ai/new', makeUrl: (prompt) => `https://claude.ai/new?q=${encodeURIComponent(prompt)}` },
  { id: 'gemini', name: 'Gemini', group: 'chat', mode: 'copy', icon: 'ph-sparkle', openUrl: 'https://gemini.google.com/app' },
  { id: 'grok', name: 'Grok', group: 'chat', mode: 'url', asset: '/brand/agents/grok.svg', openUrl: 'https://grok.com/chat', makeUrl: (prompt) => `https://grok.com/chat?reasoningMode=none&q=${encodeURIComponent(prompt)}` },
  { id: 'grok-think', name: 'Grok Think', group: 'chat', mode: 'url', asset: '/brand/agents/grok.svg', openUrl: 'https://grok.com/chat', makeUrl: (prompt) => `https://grok.com/chat?reasoningMode=think&q=${encodeURIComponent(prompt)}` },
  { id: 'grok-search', name: 'Grok Deep Search', group: 'chat', mode: 'url', asset: '/brand/agents/grok.svg', openUrl: 'https://grok.com/chat', makeUrl: (prompt) => `https://grok.com/chat?reasoningMode=deepsearch&q=${encodeURIComponent(prompt)}` },
  { id: 'mistral', name: 'Le Chat', group: 'chat', mode: 'url', asset: '/brand/agents/mistral.svg', openUrl: 'https://chat.mistral.ai/chat', makeUrl: (prompt) => `https://chat.mistral.ai/chat?q=${encodeURIComponent(prompt)}` },
  { id: 'perplexity', name: 'Perplexity', group: 'chat', mode: 'url', icon: 'ph-magnifying-glass', openUrl: 'https://www.perplexity.ai/', makeUrl: (prompt) => `https://www.perplexity.ai/search?q=${encodeURIComponent(prompt)}` },
  { id: 'phind', name: 'Phind', group: 'chat', mode: 'url', icon: 'ph-magnifying-glass', openUrl: 'https://www.phind.com/', makeUrl: (prompt) => `https://www.phind.com/search?q=${encodeURIComponent(prompt)}` },
  { id: 'you', name: 'You.com', group: 'chat', mode: 'url', icon: 'ph-globe', openUrl: 'https://you.com/', makeUrl: (prompt) => `https://you.com/search?q=${encodeURIComponent(prompt)}` },
  { id: 'huggingchat', name: 'HuggingChat', group: 'chat', mode: 'url', icon: 'ph-smiley', openUrl: 'https://huggingface.co/chat/', makeUrl: (prompt) => `https://huggingface.co/chat/?prompt=${encodeURIComponent(prompt)}` },
  { id: 'poe', name: 'Poe', group: 'chat', mode: 'url', icon: 'ph-chats', openUrl: 'https://poe.com/', makeUrl: (prompt) => `https://poe.com/?q=${encodeURIComponent(prompt)}` },
  { id: 'meta', name: 'Meta AI', group: 'chat', mode: 'url', icon: 'ph-meta-logo', openUrl: 'https://www.meta.ai/', makeUrl: (prompt) => `https://www.meta.ai/?q=${encodeURIComponent(prompt)}` },
  { id: 'manus', name: 'Manus', group: 'chat', mode: 'url', icon: 'ph-hand', openUrl: 'https://manus.im/app', makeUrl: (prompt) => `https://manus.im/app?q=${encodeURIComponent(prompt)}` },
  { id: 'copilot', name: 'Microsoft Copilot', group: 'chat', mode: 'copy', asset: '/brand/agents/copilot.svg', openUrl: 'https://copilot.microsoft.com/' },
  { id: 'deepseek', name: 'DeepSeek', group: 'chat', mode: 'copy', icon: 'ph-wave-sine', openUrl: 'https://chat.deepseek.com/' },
  { id: 'pi', name: 'Pi', group: 'chat', mode: 'copy', icon: 'ph-pi', openUrl: 'https://pi.ai/' },
  { id: 'codex', name: 'Codex', group: 'code', mode: 'copy', asset: '/brand/agents/codex.svg', openUrl: 'https://chatgpt.com/codex' },
  { id: 'cursor', name: 'Cursor', group: 'code', mode: 'deeplink', icon: 'ph-cursor', makeUrl: (prompt) => `cursor://anysphere.cursor-deeplink/prompt?text=${encodeURIComponent(prompt)}` },
  { id: 'vscode', name: 'VS Code · Copilot Chat', group: 'code', mode: 'deeplink', asset: '/brand/agents/copilot.svg', makeUrl: (prompt) => `vscode://GitHub.Copilot-Chat/chat?prompt=${encodeURIComponent(prompt)}` },
  { id: 'vscode-insiders', name: 'VS Code Insiders', group: 'code', mode: 'deeplink', icon: 'ph-code', makeUrl: (prompt) => `vscode-insiders://GitHub.Copilot-Chat/chat?prompt=${encodeURIComponent(prompt)}` },
  { id: 'goose', name: 'Goose', group: 'code', mode: 'deeplink', icon: 'ph-bird', makeUrl: (prompt, skill) => gooseRecipe(prompt, skill) },
  { id: 'v0', name: 'v0', group: 'code', mode: 'url', icon: 'ph-square', openUrl: 'https://v0.dev/chat', makeUrl: (prompt) => `https://v0.dev/chat?q=${encodeURIComponent(prompt)}` },
  { id: 'bolt', name: 'Bolt', group: 'code', mode: 'url', icon: 'ph-lightning', openUrl: 'https://bolt.new/', makeUrl: (prompt) => `https://bolt.new/?prompt=${encodeURIComponent(prompt)}` },
  { id: 'lovable', name: 'Lovable', group: 'code', mode: 'url', icon: 'ph-heart', openUrl: 'https://lovable.dev/', makeUrl: (prompt) => `https://lovable.dev/?autosubmit=true#prompt=${encodeURIComponent(prompt)}` },
  { id: 'netlify', name: 'Netlify', group: 'code', mode: 'url', icon: 'ph-diamond', openUrl: 'https://app.netlify.com/', makeUrl: (prompt) => `https://app.netlify.com/run?prompt=${encodeURIComponent(prompt)}` },
  { id: 'ai2sql', name: 'AI2SQL', group: 'code', mode: 'url', icon: 'ph-database', openUrl: 'https://builder.ai2sql.io/', makeUrl: (prompt) => `https://builder.ai2sql.io/dashboard/builder-all-lp?tab=generate&prompt=${encodeURIComponent(prompt)}` },
];

const programAssets: Record<string, string> = {
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
  return russian ? russianText : english;
}

function categoryLabel(category: string) {
  return russian ? categoryRussian[category] ?? category : category;
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
  const icon = document.createElement('i');
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

function gooseRecipe(prompt: string, skill: Skill) {
  const config = {
    version: '1.0.0',
    title: skill.name,
    description: summary(skill.prompt),
    instructions: 'This is a Super ii Skill. Follow the complete instructions below.',
    prompt,
    activities: ['message:This skill was opened from Super ii.', 'Do it now', 'Review the instructions'],
  };
  const bytes = new TextEncoder().encode(JSON.stringify(config));
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return `goose://recipe?config=${btoa(binary)}`;
}

const search = required<HTMLInputElement>('[data-skills-search]');
const count = required<HTMLElement>('[data-skills-count]');
const filters = required<HTMLElement>('[data-skills-filters]');
const grid = required<HTMLElement>('[data-skills-grid]');
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

let skills: Skill[] = [];
let activeCategory = 'All';
let activeSkill: Skill | null = null;
let activeLaunchTab: LaunchGroup = 'chat';
let pendingTarget: LaunchTarget | null = null;
let loading = false;

function searchable(skill: Skill) {
  return [
    skill.name,
    skill.category,
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
  const url = new URL(russian ? '/ru/skills' : '/skills', document.baseURI);
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
    copy.textContent = ui('No setup needed', 'Настройка не нужна');
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
    copy.textContent = ui('No setup needed', 'Настройка не нужна');
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
  number.textContent = String(index + 1).padStart(3, '0');
  top.appendChild(mark);
  top.appendChild(number);

  const title = document.createElement('strong');
  title.textContent = skill.name;
  const copy = document.createElement('span');
  copy.className = 'skill-card__copy';
  copy.textContent = summary(skill.prompt);
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

function renderCards() {
  const visible = visibleSkills();
  grid.replaceChildren(...visible.map(makeCard));
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
    const response = await fetch('/api/skills', {
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
  if (target.mode === 'deeplink') return ui('Desktop', 'Приложение');
  if (target.mode === 'copy') return ui('Copy + open', 'Копировать + открыть');
  return ui('Direct', 'Сразу');
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
  activeLaunchTab = normalizeName(activeSkill.category) === 'vibe coding'
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
    prompt = prompt.replace(pattern, value);
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

function showHandoff(target: LaunchTarget, copied: boolean, reason: 'copy' | 'long' | 'blocked') {
  launcherPicker.hidden = true;
  launcherVariables.hidden = true;
  launcherHandoff.hidden = false;
  launcherTitle.textContent = target.name;
  launcherHandoffTitle.textContent = copied
    ? ui(`Open ${target.name} and paste the skill.`, `Откройте ${target.name} и вставьте навык.`)
    : ui('Copy was blocked by the browser.', 'Браузер заблокировал копирование.');
  launcherHandoffCopy.textContent = copied
    ? reason === 'long'
      ? ui('This complete skill is too long for a reliable URL handoff, so it is safely on your clipboard.', 'Полный навык слишком длинный для надёжной ссылки, поэтому он скопирован.')
      : ui('Nothing was sent through Super ii. The complete skill is on your clipboard.', 'Через Super ii ничего не отправлялось. Полный навык находится в буфере обмена.')
    : ui('Use Copy in the skill window, then open your AI tool and paste it.', 'Используйте «Копировать» в окне навыка, затем откройте ИИ-инструмент и вставьте его.');
  if (target.openUrl) {
    launcherHandoffOpen.href = target.openUrl;
    launcherHandoffOpen.textContent = ui(`Open ${target.name} ↗`, `Открыть ${target.name} ↗`);
    launcherHandoffOpen.hidden = false;
  } else {
    launcherHandoffOpen.hidden = true;
    launcherHandoffOpen.removeAttribute('href');
  }
  window.requestAnimationFrame(positionLauncher);
}

async function launchSkill(target: LaunchTarget, prompt: string) {
  if (!activeSkill) return;
  rememberTarget(target);

  if (target.mode === 'copy' || prompt.length > DIRECT_PROMPT_LIMIT) {
    const copied = await copyText(prompt);
    showHandoff(target, copied, prompt.length > DIRECT_PROMPT_LIMIT ? 'long' : 'copy');
    return;
  }

  if (target.mode === 'deeplink') {
    const copied = await copyText(prompt);
    const url = target.makeUrl?.(prompt, activeSkill);
    if (!url) {
      showHandoff(target, copied, 'blocked');
      return;
    }
    window.location.href = url;
    dialogStatus.textContent = ui(`Skill prepared for ${target.name}.`, `Навык подготовлен для ${target.name}.`);
    launcher.close();
    return;
  }

  const url = target.makeUrl?.(prompt, activeSkill);
  if (!url) {
    const copied = await copyText(prompt);
    showHandoff(target, copied, 'blocked');
    return;
  }
  const opened = window.open(url, '_blank');
  if (!opened) {
    const copied = await copyText(prompt);
    showHandoff(target, copied, 'blocked');
    return;
  }
  try { opened.opener = null; } catch { /* Browser-enforced isolation is sufficient. */ }
  dialogStatus.textContent = ui(`Opened ${target.name}.`, `Открыт ${target.name}.`);
  launcher.close();
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
launcherHandoffOpen.addEventListener('click', () => launcher.close());
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

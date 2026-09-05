import type { Skill, SkillsCatalog } from '@/lib/skills';

const glyphs: Record<string, string> = {
  marketing: '✦',
  ops: '⌘',
  personal: '◡',
  productivity: '↗',
  sales: '◆',
  success: '◎',
};

function required<T extends Element>(selector: string): T {
  const element = document.querySelector(selector);
  if (!element) throw new Error(`Skills interface is missing ${selector}`);
  return element as T;
}

function isSkill(value: unknown): value is Skill {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const skill = value as Record<string, unknown>;
  return typeof skill.slug === 'string'
    && typeof skill.name === 'string'
    && typeof skill.category === 'string'
    && typeof skill.prompt === 'string'
    && Array.isArray(skill.integrations)
    && skill.integrations.every((item) => typeof item === 'string');
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
const dialogIntegrations = required<HTMLElement>('[data-skill-window-integrations]');
const dialogPrompt = required<HTMLElement>('[data-skill-window-prompt]');
const dialogStatus = required<HTMLElement>('[data-skill-window-status]');
const dialogClose = required<HTMLButtonElement>('[data-skill-window-close]');
const copyButton = required<HTMLButtonElement>('[data-skill-window-copy]');
const setupButton = required<HTMLButtonElement>('[data-skill-window-setup]');

let skills: Skill[] = [];
let activeCategory = 'All';
let activeSkill: Skill | null = null;
let loading = false;

function searchable(skill: Skill) {
  return [skill.name, skill.category, ...skill.integrations, skill.prompt].join(' ').toLocaleLowerCase();
}

function visibleSkills() {
  const query = search.value.trim().toLocaleLowerCase();
  return skills.filter((skill) => (
    (activeCategory === 'All' || skill.category === activeCategory)
    && (!query || searchable(skill).includes(query))
  ));
}

function integrationLabel(skill: Skill) {
  if (!skill.integrations.length) return 'No integration required';
  const visible = skill.integrations.slice(0, 2).join(' · ');
  return skill.integrations.length > 2 ? `${visible} · +${skill.integrations.length - 2}` : visible;
}

function openSkill(skill: Skill) {
  activeSkill = skill;
  dialogTitle.textContent = skill.name;
  dialogCategory.textContent = skill.category;
  dialogMark.textContent = glyph(skill.category);
  dialogPrompt.textContent = skill.prompt;
  dialogStatus.textContent = '';
  dialogIntegrations.replaceChildren();
  const names = skill.integrations.length ? skill.integrations : ['No integration required'];
  names.forEach((name) => {
    const item = document.createElement('span');
    item.textContent = name;
    dialogIntegrations.appendChild(item);
  });
  document.body.classList.add('skill-window-open');
  dialog.showModal();
}

function makeCard(skill: Skill, index: number) {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'skill-card';
  card.dataset.skillSlug = skill.slug;
  card.setAttribute('aria-label', `Open ${skill.name} skill`);

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
  category.textContent = skill.category;
  const integrations = document.createElement('small');
  integrations.textContent = integrationLabel(skill);
  meta.appendChild(category);
  meta.appendChild(integrations);
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
  const suffix = activeCategory === 'All' ? '' : ` in ${activeCategory}`;
  count.textContent = `${visible.length} ${visible.length === 1 ? 'skill' : 'skills'}${suffix}`;
}

function renderFilters() {
  const categories = [...new Set(skills.map((skill) => skill.category))]
    .sort((left, right) => left.localeCompare(right));
  filters.replaceChildren();
  ['All', ...categories].forEach((category) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = category;
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
  count.textContent = 'Loading skills…';
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
  } catch {
    grid.hidden = true;
    empty.hidden = true;
    error.hidden = false;
    count.textContent = 'Skills unavailable';
  } finally {
    loading = false;
    retry.disabled = false;
  }
}

search.addEventListener('input', renderCards);
search.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && search.value) {
    search.value = '';
    renderCards();
  }
});
document.addEventListener('keydown', (event) => {
  if (event.key === '/' && document.activeElement !== search && !dialog.open) {
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
  document.body.classList.remove('skill-window-open');
});
copyButton.addEventListener('click', async () => {
  if (!activeSkill) return;
  try {
    if (!navigator.clipboard?.writeText) throw new Error('copy unavailable');
    await navigator.clipboard.writeText(activeSkill.prompt);
    dialogStatus.textContent = 'Complete prompt copied.';
    copyButton.classList.add('is-copied');
    window.setTimeout(() => {
      dialogStatus.textContent = '';
      copyButton.classList.remove('is-copied');
    }, 1800);
  } catch {
    dialogStatus.textContent = 'Copy was blocked. Select the prompt manually.';
  }
});
setupButton.addEventListener('click', () => {
  if (!activeSkill) return;
  const context = {
    name: activeSkill.name,
    category: activeSkill.category,
    integrations: [...activeSkill.integrations],
    prompt: activeSkill.prompt,
  };
  dialog.close();
  window.dispatchEvent(new CustomEvent('superii:skill-setup', { detail: context }));
});

void loadSkills();

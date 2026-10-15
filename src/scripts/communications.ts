import { suggestPageAddress } from '@/lib/communication-presentation';

const root = document.querySelector<HTMLElement>('.communications-skin');

// Hash links retain their meaning when the destination is a closed disclosure.
function revealTarget(hash: string, focus: boolean) {
  if (!hash || hash === '#') return;
  let id: string;
  try { id = decodeURIComponent(hash.slice(1)); } catch { return; }
  const target = document.getElementById(id);
  if (!target || !root?.contains(target)) return;
  let ancestor: HTMLElement | null = target;
  while (ancestor && ancestor !== root) {
    if (ancestor instanceof HTMLDetailsElement) ancestor.open = true;
    ancestor = ancestor.parentElement;
  }
  if (focus) {
    const control = target instanceof HTMLDetailsElement ? target.querySelector('summary') : target;
    if (control instanceof HTMLElement) {
      if (!control.hasAttribute('tabindex') && control.tagName !== 'SUMMARY') control.tabIndex = -1;
      control.focus({ preventScroll: true });
    }
    target.scrollIntoView({ block: 'start' });
  }
}
root?.addEventListener('click', (event) => {
  const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href^="#"]') : null;
  if (link) revealTarget(link.hash, true);
});
window.addEventListener('hashchange', () => revealTarget(location.hash, true));
revealTarget(location.hash, Boolean(location.hash));

// Reveal invalid fields before the browser moves focus, including nested panels.
root?.addEventListener('invalid', (event) => {
  const field = event.target;
  if (!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement)) return;
  const firstInvalid = field.form && [...field.form.elements].find((control) =>
    (control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement)
    && control.willValidate && !control.validity.valid);
  // Opening a second exclusive panel would hide the first invalid field.
  if (firstInvalid && firstInvalid !== field) { event.preventDefault(); return; }
  let ancestor = field.parentElement;
  while (ancestor && ancestor !== root) {
    if (ancestor instanceof HTMLDetailsElement) ancestor.open = true;
    ancestor = ancestor.parentElement;
  }
}, true);

root?.querySelectorAll<HTMLFormElement>('[data-writing-form]').forEach((form) => {
  const title = form.querySelector<HTMLInputElement>('[name="title"]');
  const slug = form.querySelector<HTMLInputElement>('[name="slug"]');
  const fallback = `${form.dataset.writingForm}-${crypto.randomUUID().slice(0, 8)}`;
  let edited = Boolean(slug?.value);
  const suggest = () => {
    if (!title || !slug || edited) return;
    slug.value = suggestPageAddress(title.value, fallback);
  };
  title?.addEventListener('input', suggest);
  slug?.addEventListener('input', () => { edited = Boolean(slug.value); });
  form.addEventListener('reset', () => { edited = false; });

  const preview = form.querySelector<HTMLDetailsElement>('[data-writing-preview]');
  const refreshPreview = () => {
    preview?.querySelectorAll<HTMLElement>('[data-preview-field]').forEach((node) => {
      const field = form.elements.namedItem(node.dataset.previewField ?? '');
      node.textContent = field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement ? field.value : '';
    });
  };
  preview?.addEventListener('toggle', refreshPreview);
  form.addEventListener('input', () => { if (preview?.open) refreshPreview(); });
});

root?.querySelectorAll<HTMLElement>('[data-collection-filter]').forEach((collection) => {
  const search = collection.querySelector<HTMLInputElement>('[data-collection-search]');
  const buttons = [...collection.querySelectorAll<HTMLButtonElement>('[data-category-filter]')];
  const items = [...collection.querySelectorAll<HTMLElement>('[data-collection-item]')];
  const empty = collection.querySelector<HTMLElement>('[data-filter-empty]');
  const status = collection.querySelector<HTMLElement>('[data-filter-count]');
  let category = 'all';
  const apply = () => {
    const query = search?.value.trim().toLocaleLowerCase() ?? '';
    let shown = 0;
    items.forEach((item) => {
      const matches = (category === 'all' || item.dataset.category === category)
        && (item.dataset.search ?? item.textContent ?? '').toLocaleLowerCase().includes(query);
      item.hidden = !matches;
      if (matches) shown++;
    });
    if (empty) empty.hidden = shown !== 0;
    if (status) status.textContent = `${shown} / ${items.length}`;
  };
  search?.addEventListener('input', apply);
  buttons.forEach((button) => button.addEventListener('click', () => {
    category = button.dataset.categoryFilter ?? 'all';
    buttons.forEach((candidate) => candidate.setAttribute('aria-pressed', String(candidate === button)));
    apply();
  }));
  apply();
});

// These switch between views without moving focus or creating another tab stop.
root?.querySelectorAll<HTMLElement>('[role="tablist"]').forEach((list) => {
  const tabs = [...list.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  const update = () => tabs.forEach((tab) => { tab.tabIndex = tab.getAttribute('aria-selected') === 'true' ? 0 : -1; });
  update();
  list.addEventListener('click', () => queueMicrotask(update));
  list.addEventListener('keydown', (event) => {
    const index = tabs.indexOf(event.target as HTMLButtonElement);
    if (index < 0 || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    tabs[next]?.click(); tabs[next]?.focus(); update();
  });
});

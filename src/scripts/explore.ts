import { suggestPageAddress } from '@/lib/communication-presentation';

const root = document.querySelector<HTMLElement>('[data-explore-page]');
function revealTarget(hash: string) {
  if (!root || !hash || hash === '#') return;
  let id: string;
  try { id = decodeURIComponent(hash.slice(1)); } catch { return; }
  const target = document.getElementById(id);
  if (!target || !root.contains(target)) return;
  let parent: HTMLElement | null = target;
  while (parent && parent !== root) {
    if (parent instanceof HTMLDetailsElement) parent.open = true;
    parent = parent.parentElement;
  }
  const control = target instanceof HTMLDetailsElement ? target.querySelector('summary') : target;
  if (control instanceof HTMLElement) {
    if (!control.hasAttribute('tabindex') && control.tagName !== 'SUMMARY') control.tabIndex = -1;
    control.focus({ preventScroll: true });
    target.scrollIntoView({ block: 'start' });
  }
}
root?.addEventListener('click', event => {
  const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href^="#"]') : null;
  if (link) revealTarget(link.hash);
});
window.addEventListener('hashchange', () => revealTarget(location.hash));
revealTarget(location.hash);

root?.addEventListener('invalid', event => {
  const field = event.target;
  if (!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement)) return;
  const first = field.form && [...field.form.elements].find(control =>
    (control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement)
    && control.willValidate && !control.validity.valid);
  if (first && first !== field) { event.preventDefault(); return; }
  let parent = field.parentElement;
  while (parent && parent !== root) {
    if (parent instanceof HTMLDetailsElement) parent.open = true;
    parent = parent.parentElement;
  }
}, true);

const switcher = root?.querySelector<HTMLDetailsElement>('[data-explore-switcher]');
switcher?.addEventListener('keydown', event => {
  if (event.key === 'Escape') { switcher.open = false; switcher.querySelector('summary')?.focus(); }
});
document.addEventListener('click', event => {
  if (switcher?.open && event.target instanceof Node && !switcher.contains(event.target)) switcher.open = false;
});

root?.querySelectorAll<HTMLFormElement>('[data-catalog]').forEach(form => {
  // Keep shareable GET URLs free of empty optional filters.
  form.addEventListener('formdata', event => {
    for (const [key, value] of [...event.formData.entries()]) if (typeof value === 'string' && !value.trim()) event.formData.delete(key);
  });
});

root?.querySelectorAll<HTMLElement>('[data-explore-filter]').forEach(directory => {
  const input = directory.querySelector<HTMLInputElement>('[data-explore-search]');
  const items = [...directory.querySelectorAll<HTMLElement>('[data-explore-item]')];
  const empty = directory.querySelector<HTMLElement>('[data-explore-empty]');
  const count = directory.querySelector<HTMLElement>('[data-explore-count]');
  const apply = () => {
    const query = input?.value.trim().toLocaleLowerCase() ?? '';
    let visible = 0;
    items.forEach(item => {
      item.hidden = !(item.dataset.search ?? item.textContent ?? '').toLocaleLowerCase().includes(query);
      if (!item.hidden) visible++;
    });
    if (empty) empty.hidden = visible !== 0;
    if (count) count.textContent = `${visible} / ${items.length}`;
  };
  input?.addEventListener('input', apply);
  directory.querySelector('[data-explore-reset]')?.addEventListener('click', () => { if (input) { input.value = ''; apply(); input.focus(); } });
});

const collectionForm = root?.querySelector<HTMLFormElement>('[data-collection-create-form]');
const title = collectionForm?.querySelector<HTMLInputElement>('[name="title"]');
const address = collectionForm?.querySelector<HTMLInputElement>('[name="slug"]');
const fallback = `collection-${crypto.randomUUID().slice(0, 8)}`;
let edited = Boolean(address?.value);
title?.addEventListener('input', () => { if (address && !edited) address.value = suggestPageAddress(title.value, fallback); });
address?.addEventListener('input', () => { edited = Boolean(address.value); });

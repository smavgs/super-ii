const journey = document.querySelector<HTMLElement>('[data-workspace-journey]');

// Deep links keep working when guidance is folded away, including commerce.
function revealJourneyTarget(hash: string) {
  if (!journey || !hash || hash === '#') return;
  let id: string;
  try { id = decodeURIComponent(hash.slice(1)); } catch { return; }
  const target = document.getElementById(id);
  if (!target || !journey.contains(target)) return;
  let parent: HTMLElement | null = target;
  while (parent && parent !== journey) {
    if (parent instanceof HTMLDetailsElement) parent.open = true;
    parent = parent.parentElement;
  }
  const focusTarget = target instanceof HTMLDetailsElement ? target.querySelector('summary') : target;
  if (focusTarget instanceof HTMLElement) {
    if (focusTarget.tagName !== 'SUMMARY' && !focusTarget.hasAttribute('tabindex')) focusTarget.tabIndex = -1;
    focusTarget.focus({ preventScroll: true });
    target.scrollIntoView({ block: 'start' });
  }
}
journey?.addEventListener('click', (event) => {
  const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href^="#"]') : null;
  if (link) revealJourneyTarget(link.hash);
});
window.addEventListener('hashchange', () => revealJourneyTarget(location.hash));
revealJourneyTarget(location.hash);

// Keep the first invalid field visible even in nested, exclusive sections.
journey?.addEventListener('invalid', (event) => {
  const field = event.target;
  if (!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement)) return;
  const first = field.form && [...field.form.elements].find((control) =>
    (control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement)
    && control.willValidate && !control.validity.valid);
  if (first && first !== field) { event.preventDefault(); return; }
  let parent = field.parentElement;
  while (parent && parent !== journey) {
    if (parent instanceof HTMLDetailsElement) parent.open = true;
    parent = parent.parentElement;
  }
}, true);

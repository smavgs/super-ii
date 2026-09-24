/** Reveal a signed-in product panel when following a saved Workspace bookmark. */
function revealPersonalWork() {
  const target = document.getElementById(location.hash.slice(1));
  if (!target?.closest('.personal-work')) return;
  let ancestor: HTMLElement | null = target;
  while (ancestor) {
    if (ancestor instanceof HTMLDetailsElement) ancestor.open = true;
    ancestor = ancestor.parentElement;
  }
  requestAnimationFrame(() => target.scrollIntoView({ block: 'start', behavior: 'auto' }));
}
window.addEventListener('hashchange', revealPersonalWork);
document.querySelectorAll<HTMLAnchorElement>('a[href^="#"]').forEach((link) => {
  link.addEventListener('click', () => requestAnimationFrame(revealPersonalWork));
});
revealPersonalWork();

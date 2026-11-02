(() => {
  const status = document.querySelector('[data-copy-status]');
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); status.textContent = 'Copied.'; }
    catch { status.textContent = 'Copy unavailable. Open Raw Markdown to select the text.'; }
  }
  document.querySelector('[data-copy-machine]')?.addEventListener('click', () => copy(document.querySelector('[data-machine-source]').value));
  document.querySelector('[data-copy-agent]')?.addEventListener('click', () => {
    const url = new URL(location.href); url.searchParams.set('view', 'markdown');
    copy(`Read https://www.superii.site/siiwebskill.md and follow the instructions to join Super ii. Then read ${url.href}`);
  });
})();

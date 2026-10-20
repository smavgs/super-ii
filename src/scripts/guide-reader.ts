export {};

// Progressive reading controls. The complete source article remains available without JavaScript.
document.querySelectorAll<HTMLElement>('[data-guide-reader]').forEach(root => {
  const article = root.querySelector<HTMLElement>('article.prose');
  const controls = root.querySelector<HTMLElement>('[data-reader-controls]');
  const select = root.querySelector('[data-reader-select]') as unknown as HTMLSelectElement | null;
  const previous = root.querySelector<HTMLButtonElement>('[data-reader-previous]');
  const next = root.querySelector<HTMLButtonElement>('[data-reader-next]');
  const all = root.querySelector<HTMLButtonElement>('[data-reader-all]');
  const position = root.querySelector<HTMLElement>('[data-reader-position]');
  if (!article || !controls || !select || !previous || !next || !all) return;
  const headings = [...article.children].filter((el): el is HTMLHeadingElement => el instanceof HTMLHeadingElement && el.tagName === 'H2');
  if (!headings.length || headings.some(heading => !heading.id)) return;
  const sections = headings.map(heading => {
    const section = document.createElement('details');
    section.className = 'explore-panel guide-section';
    const summary = document.createElement('summary');
    const body = document.createElement('div');
    body.className = 'guide-section__body';
    article.insertBefore(section, heading);
    summary.appendChild(heading);
    section.appendChild(summary);
    section.appendChild(body);
    while (section.nextSibling && !headings.includes(section.nextSibling as HTMLHeadingElement)) {
      body.appendChild(section.nextSibling);
    }
    const option = document.createElement('option');
    option.value = heading.id;
    option.textContent = heading.textContent;
    select.appendChild(option);
    return section;
  });
  let current = 0;
  let readAll = false;
  const render = () => {
    sections.forEach((section, index) => {
      section.hidden = !readAll && index !== current;
      section.open = readAll || index === current;
    });
    select.selectedIndex = current;
    previous.disabled = current === 0;
    next.disabled = current === sections.length - 1;
    if (position) position.textContent = `${current + 1} / ${sections.length}`;
    all.setAttribute('aria-pressed', String(readAll));
    root.querySelector<HTMLElement>('[data-reader-expand-label]')?.toggleAttribute('hidden', readAll);
    root.querySelector<HTMLElement>('[data-reader-single-label]')?.toggleAttribute('hidden', !readAll);
  };
  const reveal = (hash: string, focus = false) => {
    if (!hash || hash === '#') {
      current = 0;
      render();
      return;
    }
    let id: string;
    try { id = decodeURIComponent(hash.slice(1)); } catch { return; }
    const target = document.getElementById(id);
    const index = sections.findIndex(section => target && section.contains(target));
    if (index < 0) return;
    current = index;
    render();
    if (focus && target) {
      target.tabIndex = -1;
      target.focus({ preventScroll: true });
      target.scrollIntoView({ block: 'start' });
    }
  };
  const navigate = (index: number) => {
    current = Math.min(sections.length - 1, Math.max(0, index));
    const hash = `#${headings[current].id}`;
    render();
    if (location.hash === hash) reveal(hash, true);
    else location.hash = hash;
  };
  select.addEventListener('change', () => navigate(select.selectedIndex));
  previous.addEventListener('click', () => navigate(current - 1));
  next.addEventListener('click', () => navigate(current + 1));
  all.addEventListener('click', () => { readAll = !readAll; render(); });
  window.addEventListener('hashchange', () => reveal(location.hash, true));
  document.addEventListener('click', event => {
    const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href^="#"]') : null;
    if (link) reveal(link.hash, true);
  });
  // Printing always includes the entire document, then restores the chosen reading mode.
  let printState: Array<{ hidden: HTMLElement['hidden']; open: boolean }> = [];
  window.addEventListener('beforeprint', () => {
    printState = sections.map(section => ({ hidden: section.hidden, open: section.open }));
    sections.forEach(section => { section.hidden = false; section.open = true; });
  });
  window.addEventListener('afterprint', () => {
    sections.forEach((section, index) => {
      if (printState[index]) Object.assign(section, printState[index]);
    });
  });
  controls.hidden = false;
  render();
  reveal(location.hash, Boolean(location.hash));
});

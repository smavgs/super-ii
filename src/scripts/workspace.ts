import { repositoryMatches, workspaceDestination, type WorkspaceSection } from '../lib/workspace-navigation';

const root = document.querySelector<HTMLElement>('[data-member-workspace]');
if (root) {
  const panels = Array.from(root.querySelectorAll<HTMLElement>('[data-workspace-panel]'));
  const links = Array.from(root.querySelectorAll<HTMLAnchorElement>('[data-workspace-nav]'));
  const picker = root.querySelector('[data-workspace-select]') as unknown as HTMLSelectElement | null;
  const russian = document.documentElement.lang === 'ru';
  const copy = (english: string, translated: string) => russian ? translated : english;

  function reveal(target: HTMLElement) {
    let ancestor: HTMLElement | null = target;
    while (ancestor && ancestor !== root) {
      if (ancestor instanceof HTMLDetailsElement) ancestor.open = true;
      ancestor = ancestor.parentElement;
    }
  }

  function showSection(focus = false, scroll = false) {
    const url = new URL(location.href);
    const destination = workspaceDestination(url.hash, url.searchParams.get('welcome'));
    if (destination.redirect) {
      const path = russian && destination.redirect.startsWith('/organizations')
        ? `/ru${destination.redirect}` : destination.redirect;
      location.replace(path);
      return;
    }
    const panel = panels.find((candidate) => candidate.dataset.workspacePanel === destination.section);
    if (!panel) return;
    for (const candidate of panels) candidate.hidden = candidate !== panel;
    for (const link of links) {
      if (link.dataset.workspaceNav === destination.section) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
    if (picker) picker.value = destination.section;
    const target = destination.target ? document.getElementById(destination.target) : null;
    if (target && panel.contains(target)) reveal(target);
    if (url.searchParams.get('welcome') === 'ai-worker') {
      url.searchParams.delete('welcome');
      url.hash = 'setup';
      history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`);
    }
    if (focus) {
      const heading = panel.querySelector<HTMLElement>('.workspace-panel-title, h2');
      if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
    }
    if (scroll || target) requestAnimationFrame(() => (target ?? root)?.scrollIntoView({ block: 'start', behavior: 'auto' }));
    window.dispatchEvent(new CustomEvent('workspace:section', { detail: destination.section }));
  }

  function navigate(hash: string) {
    if (location.hash !== hash) history.pushState(null, '', hash);
    showSection(true, true);
  }

  root.addEventListener('click', (event) => {
    if (!(event instanceof MouseEvent) || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const summary = (event.target as Element).closest('summary');
    const disclosure = summary?.parentElement;
    if (disclosure instanceof HTMLDetailsElement && !disclosure.open) {
      // Native exclusive details can collapse thousands of pixels above this summary.
      requestAnimationFrame(() => {
        if (disclosure.open && disclosure.getBoundingClientRect().top < 96) disclosure.scrollIntoView({ block: 'start', behavior: 'auto' });
      });
      return;
    }
    const link = (event.target as Element).closest<HTMLAnchorElement>('a[href^="#"]');
    if (!link) return;
    const hash = link.getAttribute('href');
    if (!hash || hash === '#' || hash.startsWith('#/')) return;
    event.preventDefault();
    navigate(hash);
  });
  picker?.addEventListener('change', () => navigate(`#${picker.value as WorkspaceSection}`));
  window.addEventListener('hashchange', () => showSection(false, true));
  root.dataset.workspaceReady = 'true';
  const mobilePicker = root.querySelector<HTMLElement>('.workspace-mobile-picker');
  if (mobilePicker) mobilePicker.hidden = false;
  showSection();

  const search = root.querySelector<HTMLInputElement>('[data-repository-search]');
  const kind = root.querySelector('[data-repository-kind]') as unknown as HTMLSelectElement | null;
  const rows = Array.from(root.querySelectorAll<HTMLElement>('[data-repository-row]'));
  const resultCount = root.querySelector<HTMLElement>('[data-repository-results]');
  const noResults = root.querySelector<HTMLElement>('[data-repository-empty]');
  const more = root.querySelector<HTMLButtonElement>('[data-repository-more]');
  let repositoryLimit = 6;
  function filterRepositories() {
    const matches = rows.filter((row) => repositoryMatches(row.dataset.search ?? '', row.dataset.kind ?? '', search?.value ?? '', kind?.value ?? 'all'));
    for (const row of rows) row.hidden = true;
    for (const row of matches.slice(0, repositoryLimit)) row.hidden = false;
    if (resultCount) resultCount.textContent = copy(`Showing ${Math.min(repositoryLimit, matches.length)} of ${matches.length} repositories`, `Показано ${Math.min(repositoryLimit, matches.length)} из ${matches.length} репозиториев`);
    if (noResults) noResults.hidden = matches.length > 0;
    if (more) more.hidden = matches.length <= repositoryLimit;
  }
  search?.addEventListener('input', () => { repositoryLimit = 6; filterRepositories(); });
  kind?.addEventListener('change', () => { repositoryLimit = 6; filterRepositories(); });
  more?.addEventListener('click', () => {
    const previousLimit = repositoryLimit;
    repositoryLimit += 6;
    filterRepositories();
    rows.filter((row) => !row.hidden)[previousLimit]?.focus();
  });
  const filters = root.querySelector<HTMLElement>('[data-workspace-filters]');
  if (filters) filters.hidden = false;
  if (rows.length) filterRepositories();

  const activity = Array.from(root.querySelectorAll<HTMLElement>('[data-notification]'));
  const moreActivity = root.querySelector<HTMLButtonElement>('[data-activity-more]');
  let activityLimit = 3;
  function showActivity() {
    activity.forEach((item, index) => { item.hidden = index >= activityLimit; });
    if (moreActivity) moreActivity.hidden = activity.length <= activityLimit;
  }
  moreActivity?.addEventListener('click', () => {
    const next = activity[activityLimit];
    activityLimit += 5;
    showActivity();
    if (next) { next.tabIndex = -1; next.focus(); }
  });
  showActivity();

  const activityStatus = root.querySelector<HTMLElement>('[data-activity-status]');
  root.querySelectorAll<HTMLButtonElement>('[data-mark-read]').forEach((button) => button.addEventListener('click', async () => {
    const notification = button.closest<HTMLElement>('[data-notification]');
    if (!notification) return;
    button.disabled = true;
    try {
      const response = await fetch(`/api/notifications/${notification.dataset.notification}`, { method: 'POST' });
      if (!response.ok) throw new Error('Notification update failed');
      notification.dataset.read = 'true';
      notification.tabIndex = -1;
      notification.focus();
      button.remove();
      if (activityStatus) activityStatus.textContent = copy('Marked as read.', 'Отмечено как прочитанное.');
    } catch {
      button.disabled = false;
      if (activityStatus) activityStatus.textContent = copy('This notification could not be updated. Please try again.', 'Не удалось обновить уведомление. Повторите попытку.');
    }
  }));

  const syncStatus = root.querySelector<HTMLElement>('[data-bridge-sync-status]');
  root.querySelectorAll<HTMLButtonElement>('[data-bridge-sync]').forEach((button) => button.addEventListener('click', async () => {
    const enabled = button.dataset.enabled !== 'true';
    button.disabled = true;
    if (syncStatus) syncStatus.textContent = copy('Updating source checks…', 'Обновление проверок источника…');
    try {
      const response = await fetch('/api/bridge/sync', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ repository_id: button.dataset.bridgeSync, enabled }),
      });
      if (!response.ok) throw new Error('Source update failed');
      button.dataset.enabled = String(enabled);
      button.textContent = enabled ? copy('Pause checks', 'Приостановить проверки') : copy('Check for updates', 'Проверить обновления');
      button.classList.toggle('button--dark', !enabled);
      button.classList.toggle('button--secondary', enabled);
      if (syncStatus) syncStatus.textContent = enabled
        ? copy('Public-source checks are on. New revisions will still require review.', 'Проверки общедоступного источника включены. Новые версии по-прежнему требуют проверки.')
        : copy('Source checks are paused.', 'Проверки источника приостановлены.');
    } catch {
      if (syncStatus) syncStatus.textContent = copy('This source could not be changed. Please try again.', 'Не удалось изменить источник. Повторите попытку.');
    } finally { button.disabled = false; }
  }));
}

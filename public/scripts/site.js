/* Super ii progressive enhancement. The core site remains usable without JavaScript. */
(() => {
  'use strict';

  const root = document.documentElement;
  const body = document.body;
  const themeButton = document.querySelector('[data-theme-toggle]');
  const menuButton = document.querySelector('[data-menu-toggle]');
  const mobileNav = document.querySelector('[data-mobile-nav]');

  function activeTheme() {
    return root.dataset.theme === 'dark' ? 'dark' : 'light';
  }

  function syncThemeButton() {
    if (!themeButton) return;
    const dark = activeTheme() === 'dark';
    const icon = themeButton.querySelector('i');
    themeButton.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
    if (icon) icon.className = dark ? 'ph ph-moon' : 'ph ph-sun';
  }

  themeButton?.addEventListener('click', () => {
    const next = activeTheme() === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    try {
      localStorage.setItem('superii-theme', next);
    } catch {}
    syncThemeButton();
  });
  syncThemeButton();

  function closeMenu() {
    if (!menuButton || !mobileNav) return;
    menuButton.setAttribute('aria-expanded', 'false');
    menuButton.setAttribute('aria-label', 'Open navigation');
    mobileNav.hidden = true;
    body.classList.remove('menu-open');
    const icon = menuButton.querySelector('i');
    if (icon) icon.className = 'ph ph-list';
  }

  menuButton?.addEventListener('click', () => {
    if (!mobileNav) return;
    const opening = menuButton.getAttribute('aria-expanded') !== 'true';
    menuButton.setAttribute('aria-expanded', String(opening));
    menuButton.setAttribute('aria-label', opening ? 'Close navigation' : 'Open navigation');
    mobileNav.hidden = !opening;
    body.classList.toggle('menu-open', opening);
    const icon = menuButton.querySelector('i');
    if (icon) icon.className = opening ? 'ph ph-x' : 'ph ph-list';
  });

  mobileNav?.querySelectorAll('a').forEach((link) => link.addEventListener('click', closeMenu));
  window.matchMedia('(min-width: 1041px)').addEventListener('change', (event) => {
    if (event.matches) closeMenu();
  });

  const catalogSearch = document.querySelector('[data-catalog-search]');
  const emptyCopy = document.querySelector('[data-empty-copy]');
  const catalog = document.querySelector('[data-catalog]');

  catalogSearch?.addEventListener('input', () => {
    if (!emptyCopy || !catalogSearch || !catalog) return;
    const query = catalogSearch.value.trim();
    const kind = catalog.dataset.kind === 'spaces' ? 'apps' : catalog.dataset.kind;
    emptyCopy.textContent = query
      ? `No ${kind} match “${query}”. Only reviewed public releases are searchable.`
      : `No reviewed public ${kind === 'models' ? 'model' : kind === 'datasets' ? 'dataset' : 'app'} has been published yet. A real release appears here immediately after approval.`;
  });

  document.addEventListener('keydown', (event) => {
    const target = event.target;
    const typing = target instanceof HTMLElement && (
      target.isContentEditable ||
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT'
    );
    if (event.key === '/' && !typing && catalogSearch instanceof HTMLElement) {
      event.preventDefault();
      catalogSearch.focus();
    }
    if (event.key === 'Escape') closeMenu();
  });

  const contactForm = document.querySelector('[data-contact-form]');
  if (contactForm instanceof HTMLFormElement) {
    const interest = new URLSearchParams(location.search).get('interest');
    const interestSelect = contactForm.elements.namedItem('interest');
    if (interest && interestSelect instanceof HTMLSelectElement) {
      const allowed = Array.from(interestSelect.options).some((option) => option.value === interest);
      if (allowed) interestSelect.value = interest;
    }

    contactForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const submit = contactForm.querySelector('button[type="submit"]');
      const status = contactForm.querySelector('[data-form-status]');
      const formData = new FormData(contactForm);
      const payload = Object.fromEntries(formData.entries());

      if (submit instanceof HTMLButtonElement) {
        submit.disabled = true;
        submit.textContent = 'Sending…';
      }
      if (status instanceof HTMLElement) {
        status.hidden = false;
        status.dataset.state = '';
        status.textContent = 'Sending your message securely…';
      }

      try {
        const response = await fetch('/api/contact', {
          method: 'POST',
          headers: {
            'accept': 'application/json',
            'content-type': 'application/json',
          },
          body: JSON.stringify(payload),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.message || 'We could not send your message. Please try again.');

        contactForm.reset();
        if (status instanceof HTMLElement) {
          status.dataset.state = 'success';
          status.textContent = 'Message received. Thank you—we will review it as soon as possible.';
        }
      } catch (error) {
        if (status instanceof HTMLElement) {
          status.dataset.state = 'error';
          status.textContent = error instanceof Error ? error.message : 'We could not send your message. Please try again.';
        }
      } finally {
        if (submit instanceof HTMLButtonElement) {
          submit.disabled = false;
          submit.textContent = 'Send message';
        }
      }
    });
  }
})();

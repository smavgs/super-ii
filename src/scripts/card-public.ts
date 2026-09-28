export {};

const rootElement = document.querySelector<HTMLElement>('[data-public-card]');
if (rootElement) {
  const root = rootElement;
  const toast = root.querySelector<HTMLElement>('[data-card-toast]');
  let toastTimer = 0;
  const announce = (message: string) => {
    if (!toast) return;
    toast.textContent = message;
    toast.hidden = false;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => { toast.hidden = true; }, 2800);
  };

  root.querySelectorAll<HTMLButtonElement>('[data-copy-value]').forEach((button) => button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(button.dataset.copyValue ?? '');
      announce(`${button.dataset.copyLabel ?? 'Contact'} copied.`);
    } catch { announce('Copy is unavailable.'); }
  }));

  root.querySelector<HTMLButtonElement>('[data-share-card]')?.addEventListener('click', async () => {
    try {
      if (navigator.share) await navigator.share({ title: document.title, text: document.querySelector('meta[name="description"]')?.getAttribute('content') ?? '', url: location.href });
      else { await navigator.clipboard.writeText(location.href); announce('Unlisted card link copied.'); }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      announce('Sharing is unavailable.');
    }
  });

  const qrDialog = root.querySelector<HTMLDialogElement>('[data-card-qr-dialog]');
  root.querySelector('[data-show-card-qr]')?.addEventListener('click', () => qrDialog?.showModal());
  root.querySelector('[data-close-card-qr]')?.addEventListener('click', () => qrDialog?.close());
  qrDialog?.addEventListener('click', (event) => { if (event.target === qrDialog) qrDialog.close(); });

  const shareDialog = root.querySelector<HTMLDialogElement>('[data-share-back-dialog]');
  root.querySelector('[data-open-share-back]')?.addEventListener('click', () => shareDialog?.showModal());
  root.querySelector('[data-close-share-back]')?.addEventListener('click', () => shareDialog?.close());
  shareDialog?.addEventListener('click', (event) => { if (event.target === shareDialog) shareDialog.close(); });
  const shareForm = root.querySelector<HTMLFormElement>('[data-share-back-form]');
  shareForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = shareForm.querySelector<HTMLButtonElement>('button[type="submit"]');
    const status = shareForm.querySelector<HTMLElement>('[data-share-back-status]');
    if (button) button.disabled = true;
    if (status) status.textContent = 'Sending privately…';
    try {
      const data = new FormData(shareForm);
      const response = await fetch(`/api/cards/public/${location.pathname.split('/').filter(Boolean).at(-1)}/connections`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(Object.fromEntries(data.entries())),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Your details could not be shared');
      if (status) status.textContent = 'Shared. Only the card owner can read it.';
      shareForm.reset();
      window.setTimeout(() => shareDialog?.close(), 1300);
    } catch (error) {
      if (status) status.textContent = error instanceof Error ? error.message : 'Your details could not be shared';
    } finally { if (button) button.disabled = false; }
  });

  const localeData = root.querySelector<HTMLScriptElement>('[data-card-locales]');
  if (localeData) {
    const identities = JSON.parse(localeData.textContent ?? '{}') as Record<string, { name: string; role: string; organization: string; tagline: string; bio: string }>;
    root.querySelectorAll<HTMLButtonElement>('[data-card-language]').forEach((button) => button.addEventListener('click', () => {
      const locale = button.dataset.cardLanguage ?? 'en';
      const identity = identities[locale];
      if (!identity) return;
      root.dataset.locale = locale;
      document.documentElement.lang = locale;
      root.querySelector<HTMLElement>('[data-identity-name]')!.textContent = identity.name;
      root.querySelector<HTMLElement>('[data-identity-role]')!.textContent = [identity.role, identity.organization].filter(Boolean).join(' · ');
      const tagline = root.querySelector<HTMLElement>('[data-identity-tagline]');
      if (tagline) { tagline.textContent = identity.tagline; tagline.hidden = !identity.tagline; }
      const bio = root.querySelector<HTMLElement>('[data-identity-bio]');
      if (bio) { bio.textContent = identity.bio; bio.hidden = !identity.bio; }
      root.querySelectorAll<HTMLElement>('[data-card-recipient-name]').forEach((node) => { node.textContent = identity.name; });
      const vcard = root.querySelector<HTMLAnchorElement>('[data-card-vcard]');
      if (vcard) {
        const url = new URL(vcard.href, location.href);
        if (locale === 'zh-CN') url.searchParams.set('language', 'zh-CN');
        else url.searchParams.delete('language');
        vcard.href = url.toString();
      }
      root.querySelectorAll<HTMLButtonElement>('[data-card-language]').forEach((candidate) => candidate.setAttribute('aria-pressed', String(candidate === button)));
    }));
  }
}

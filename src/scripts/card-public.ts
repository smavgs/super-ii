import {
  cardPublicPersonalBadgeLabels,
  cardPublicServiceLabels,
  cardPublicUi,
  cardPublicVerifiedBadgeLabels,
  type CardPublicLocale,
} from '../lib/card-public-i18n';
import type { CardServiceId, PersonalBadgeId, VerifiedBadgeId } from '../lib/cards';

type CardIdentity = { name: string; role: string; organization: string; tagline: string; bio: string };
type UiCopy = typeof cardPublicUi.en;

const rootElement = document.querySelector<HTMLElement>('[data-public-card]');
if (rootElement) {
  const root = rootElement;
  const toast = root.querySelector<HTMLElement>('[data-card-toast]');
  const localeData = root.querySelector<HTMLScriptElement>('[data-card-locales]');
  const identities = localeData
    ? JSON.parse(localeData.textContent ?? '{}') as Partial<Record<CardPublicLocale, CardIdentity>>
    : {};
  let activeLocale: CardPublicLocale = root.dataset.locale === 'zh-CN' ? 'zh-CN' : 'en';
  let toastTimer = 0;

  const copy = (): UiCopy => cardPublicUi[activeLocale] as UiCopy;
  const announce = (message: string) => {
    if (!toast) return;
    toast.textContent = message;
    toast.hidden = false;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => { toast.hidden = true; }, 2800);
  };

  function applyLocale(locale: CardPublicLocale) {
    const identity = identities[locale] ?? identities.en;
    if (locale === 'zh-CN' && !identity) return;
    activeLocale = locale;
    const ui = copy() as Record<string, string>;
    root.dataset.locale = locale;
    document.documentElement.lang = locale;
    const skipLink = document.querySelector<HTMLElement>('[data-card-skip-link]');
    if (skipLink) skipLink.textContent = ui.skipToCard;

    root.querySelectorAll<HTMLElement>('[data-card-copy]').forEach((node) => {
      const key = node.dataset.cardCopy ?? '';
      if (ui[key]) node.textContent = ui[key];
    });
    root.querySelectorAll<HTMLElement>('[data-card-aria-label]').forEach((node) => {
      const key = node.dataset.cardAriaLabel ?? '';
      if (ui[key]) node.setAttribute('aria-label', ui[key]);
    });
    root.querySelectorAll<HTMLElement>('[data-card-title]').forEach((node) => {
      const key = node.dataset.cardTitle ?? '';
      if (ui[key]) node.title = ui[key];
    });
    root.querySelectorAll<HTMLElement>('[data-card-service-id]').forEach((node) => {
      const service = node.dataset.cardServiceId as CardServiceId | 'custom' | undefined;
      if (service && service !== 'custom') node.textContent = cardPublicServiceLabels[locale][service];
      const action = node.closest<HTMLElement>('[data-copy-label]');
      if (action && service && service !== 'custom') action.dataset.copyLabel = cardPublicServiceLabels[locale][service];
    });
    root.querySelectorAll<HTMLElement>('[data-card-verified-badge]').forEach((node) => {
      const badge = node.dataset.cardVerifiedBadge as VerifiedBadgeId | undefined;
      if (badge) node.textContent = cardPublicVerifiedBadgeLabels[locale][badge];
    });
    root.querySelectorAll<HTMLElement>('[data-card-personal-badge]').forEach((node) => {
      const badge = node.dataset.cardPersonalBadge as PersonalBadgeId | undefined;
      if (badge) node.textContent = cardPublicPersonalBadgeLabels[locale][badge];
    });

    if (identity) {
      const name = root.querySelector<HTMLElement>('[data-identity-name]');
      const role = root.querySelector<HTMLElement>('[data-identity-role]');
      if (name) name.textContent = identity.name;
      if (role) role.textContent = [identity.role, identity.organization].filter(Boolean).join(' · ');
      const tagline = root.querySelector<HTMLElement>('[data-identity-tagline]');
      if (tagline) { tagline.textContent = identity.tagline; tagline.hidden = !identity.tagline; }
      const bio = root.querySelector<HTMLElement>('[data-identity-bio]');
      if (bio) { bio.textContent = identity.bio; bio.hidden = !identity.bio; }
      root.querySelectorAll<HTMLElement>('[data-card-recipient-name]').forEach((node) => { node.textContent = identity.name; });
      const photo = root.querySelector<HTMLImageElement>('[data-card-photo]');
      if (photo) photo.alt = locale === 'zh-CN' ? `${identity.name}${copy().profilePhoto}` : `${identity.name} ${copy().profilePhoto}`;
      const qrImage = root.querySelector<HTMLImageElement>('[data-card-qr-image]');
      if (qrImage) qrImage.alt = `${copy().qrCode} ${identity.name}`;
      const description = [identity.role, identity.organization, identity.tagline].filter(Boolean).join(' · ');
      document.title = `${identity.name} · ${copy().brand}`;
      document.querySelector<HTMLMetaElement>('meta[name="description"]')?.setAttribute('content', description || copy().brand);
    }

    const vcard = root.querySelector<HTMLAnchorElement>('[data-card-vcard]');
    if (vcard) {
      const url = new URL(vcard.href, location.href);
      if (locale === 'zh-CN') url.searchParams.set('language', 'zh-CN');
      else url.searchParams.delete('language');
      vcard.href = url.toString();
    }
    root.querySelectorAll<HTMLButtonElement>('[data-card-language]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.cardLanguage === locale));
    });
  }

  root.querySelectorAll<HTMLButtonElement>('button[data-copy-value]').forEach((button) => button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(button.dataset.copyValue ?? '');
      announce(`${button.dataset.copyLabel ?? copy().contactLinks} ${copy().copied}`);
    } catch { announce(copy().copyUnavailable); }
  }));

  root.querySelectorAll<HTMLAnchorElement>('[data-open-wechat]').forEach((link) => link.addEventListener('click', () => {
    const value = link.dataset.copyValue ?? '';
    if (value) void navigator.clipboard.writeText(value).catch(() => undefined);
    announce(copy().wechatOpening);
  }));

  root.querySelector<HTMLButtonElement>('[data-share-card]')?.addEventListener('click', async () => {
    try {
      if (navigator.share) await navigator.share({ title: document.title, text: document.querySelector('meta[name="description"]')?.getAttribute('content') ?? '', url: location.href });
      else { await navigator.clipboard.writeText(location.href); announce(copy().cardLinkCopied); }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      announce(copy().sharingUnavailable);
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
    if (status) status.textContent = copy().sendingPrivately;
    try {
      const data = new FormData(shareForm);
      const response = await fetch(`/api/cards/public/${location.pathname.split('/').filter(Boolean).at(-1)}/connections`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(Object.fromEntries(data.entries())),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? copy().shareBackFailed);
      if (status) status.textContent = copy().sharedPrivately;
      shareForm.reset();
      window.setTimeout(() => shareDialog?.close(), 1300);
    } catch (error) {
      if (status) status.textContent = error instanceof Error ? error.message : copy().shareBackFailed;
    } finally { if (button) button.disabled = false; }
  });

  root.querySelectorAll<HTMLButtonElement>('[data-card-language]').forEach((button) => button.addEventListener('click', () => {
    applyLocale(button.dataset.cardLanguage === 'zh-CN' ? 'zh-CN' : 'en');
  }));

  applyLocale(activeLocale);
}

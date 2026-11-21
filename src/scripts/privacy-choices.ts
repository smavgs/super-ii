import { ANALYTICS_COOKIE, ANALYTICS_MAX_AGE, analyticsChoice, type AnalyticsChoice } from '../lib/experience';
import { welcomeCopy } from '../lib/welcome';
import { installExperienceClicks, trackCurrentPage } from './experience';

const dialog = document.querySelector<HTMLDialogElement>('[data-privacy-choices]');
const copy = welcomeCopy[document.documentElement.lang as keyof typeof welcomeCopy] ?? welcomeCopy.en;
let returnFocus: HTMLElement | null = null;
let dismissed = false;
let channel: BroadcastChannel | null = null;
try { channel = new BroadcastChannel('superii-privacy'); } catch { /* Cookie reads still gate every event. */ }

function close(): void {
  const wasOpen = dialog?.open;
  dialog?.close();
  delete document.documentElement.dataset.privacyOpen;
  if (wasOpen && returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
}
function open(opener: HTMLElement | null = null): void {
  if (!dialog || dialog.open || typeof dialog.showModal !== 'function') return;
  returnFocus = opener;
  const current = dialog.querySelector<HTMLElement>('[data-privacy-current]');
  if (current) current.textContent = analyticsChoice(document.cookie) === 'allow' ? copy.on : copy.off;
  dialog.showModal();
  document.documentElement.dataset.privacyOpen = '';
  dialog.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
}
function choose(choice: AnalyticsChoice): void {
  dismissed = true;
  document.cookie = `${ANALYTICS_COOKIE}=${choice}-v1; Path=/; Max-Age=${ANALYTICS_MAX_AGE}; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
  close();
  channel?.postMessage(choice);
  // A blocked preference cookie leaves analytics off, including on this page.
  if (choice === 'allow') trackCurrentPage();
}

dialog?.querySelectorAll<HTMLButtonElement>('[data-privacy-choice]').forEach(button => button.addEventListener('click', () => choose(button.dataset.privacyChoice === 'allow' ? 'allow' : 'deny')));
dialog?.addEventListener('cancel', event => { event.preventDefault(); choose('deny'); });
dialog?.addEventListener('close', () => { delete document.documentElement.dataset.privacyOpen; });
document.querySelectorAll<HTMLAnchorElement>('[data-privacy-open]').forEach(link => link.addEventListener('click', event => {
  if (!dialog || typeof dialog.showModal !== 'function') return;
  event.preventDefault(); open(link);
}));
channel?.addEventListener('message', () => { if (analyticsChoice(document.cookie)) { dismissed = true; close(); } });

installExperienceClicks();
trackCurrentPage();
// Do not interrupt typing, another modal, or navigation. The footer remains
// available if the visitor begins interacting before this first invitation.
if (dialog?.dataset.autoOpen === 'true' && !analyticsChoice(document.cookie)) {
  window.setTimeout(() => {
    if (dismissed || analyticsChoice(document.cookie) || document.visibilityState !== 'visible' || scrollY > innerHeight / 3 || document.querySelector('dialog[open]') || document.querySelector('[data-menu-toggle][aria-expanded="true"]')) return;
    if (document.activeElement?.matches('input, textarea, select, [contenteditable="true"]')) return;
    open(document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null);
  }, 900);
}

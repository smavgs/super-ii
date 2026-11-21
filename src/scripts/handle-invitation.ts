import { requestedHandle, RESERVED_HANDLES, welcomeCopy } from '../lib/welcome';
import { trackExperience } from './experience';
import { $authStore } from '@clerk/astro/client';

const root = document.querySelector<HTMLElement>('[data-handle-invitation]');
const form = root?.querySelector<HTMLFormElement>('[data-handle-form]');
const input = root?.querySelector<HTMLInputElement>('[data-handle-input]');
const submit = root?.querySelector<HTMLButtonElement>('[data-handle-submit]');
const toggle = root?.querySelector<HTMLButtonElement>('[data-handle-toggle]');
const status = root?.querySelector<HTMLElement>('[data-handle-status]');
const copy = welcomeCopy[document.documentElement.lang as keyof typeof welcomeCopy] ?? welcomeCopy.en;
if (root) $authStore.subscribe(auth => { root.hidden = Boolean(auth.userId); });
let checked: string | null = null;
let request: AbortController | null = null;
let sequence = 0;

function message(text: string, state = ''): void {
  if (!status) return;
  status.textContent = text;
  status.hidden = !text;
  status.dataset.state = state;
}
function expand(): void {
  if (!root) return;
  root.dataset.expanded = '';
  toggle?.setAttribute('aria-expanded', 'true');
  message(copy.hint);
  input?.focus();
  trackExperience('handle_open', 'home', true);
}
function collapse(): void {
  if (!root) return;
  delete root.dataset.expanded;
  toggle?.setAttribute('aria-expanded', 'false');
  message('');
  toggle?.focus();
}
toggle?.addEventListener('click', expand);
root?.querySelector('[data-handle-collapse]')?.addEventListener('click', collapse);
root?.addEventListener('keydown', event => { if (event.key === 'Escape' && matchMedia('(max-width: 700px)').matches) collapse(); });
input?.addEventListener('input', () => {
  sequence++;
  request?.abort();
  checked = null;
  input.removeAttribute('aria-invalid');
  if (submit) { submit.disabled = false; submit.textContent = `${copy.check} ↗`; }
  message('');
});
input?.addEventListener('focus', () => trackExperience('handle_open', 'home', true));

form?.addEventListener('submit', async event => {
  if (!input || !submit) return;
  const handle = requestedHandle(input.value);
  if (handle && checked === handle) { input.value = handle; return; }
  event.preventDefault();
  if (!handle) { input.setAttribute('aria-invalid', 'true'); message(RESERVED_HANDLES.has(input.value.trim().toLowerCase().replace(/^@/, '')) ? copy.unavailable : copy.invalid); input.focus(); return; }
  const current = ++sequence;
  request?.abort();
  request = new AbortController();
  const controller = request;
  const timeout = window.setTimeout(() => controller.abort(), 12_000);
  submit.disabled = true;
  submit.textContent = copy.checking;
  message(copy.checking);
  trackExperience('handle_check', 'home');
  try {
    const response = await fetch('/api/handles/check', {
      method: 'POST', credentials: 'same-origin', signal: controller.signal,
      referrerPolicy: 'no-referrer', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ handle }),
    });
    if (current !== sequence) return;
    if (!response.ok) { message(response.status === 429 ? copy.limited : copy.failed); trackExperience('handle_error', 'home', true); return; }
    const result = await response.json() as { available?: boolean };
    if (current !== sequence) return;
    if (result.available === true) {
      checked = handle;
      input.value = handle;
      message(copy.available, 'available');
    } else { message(copy.unavailable); input.focus(); }
  } catch {
    if (current === sequence) { message(copy.failed); trackExperience('handle_error', 'home', true); }
  } finally {
    clearTimeout(timeout);
    if (current === sequence) { submit.disabled = false; submit.textContent = `${checked ? copy.join : copy.check} ↗`; }
  }
});

const header = document.querySelector<HTMLElement>('[data-site-header]');
if (header && root) {
  const position = () => root.style.setProperty('--welcome-header-height', `${header.getBoundingClientRect().height}px`);
  position();
  new ResizeObserver(position).observe(header);
}
// Animate only an empty placeholder; never modify what someone is typing.
if (input && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const words = ['yourname', 'yourlab', 'yourteam'];
  let word = 0, length = words[0].length, erase = true, pause = 12;
  window.setInterval(() => {
    if (input.value || document.activeElement === input || document.visibilityState !== 'visible' || document.querySelector('dialog[open]')) return;
    if (pause-- > 0) return;
    length += erase ? -1 : 1;
    input.placeholder = words[word].slice(0, Math.max(0, length));
    if (length <= 0) { erase = false; word = (word + 1) % words.length; }
    if (length >= words[word].length) { erase = true; pause = 16; }
  }, 115);
}

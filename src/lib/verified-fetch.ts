import '../styles/verification.css';

type Verification = { status: string; supportedFirstFactors?: Array<{ strategy: string; emailAddressId?: string; safeIdentifier?: string }> | null };
type VerificationSession = {
  id: string;
  startVerification(input: { level: 'first_factor' }): Promise<Verification>;
  prepareFirstFactorVerification(input: { strategy: 'email_code'; emailAddressId: string }): Promise<Verification>;
  attemptFirstFactorVerification(input: { strategy: 'email_code'; code: string }): Promise<Verification>;
  getToken(input: { skipCache: true }): Promise<string | null>;
};
let pending: Promise<string> | null = null;

function reverify(): Promise<string> {
  const session = (window as unknown as { Clerk?: { session?: VerificationSession } }).Clerk?.session;
  if (!session) return Promise.reject(new Error('Please sign in again before granting access.'));
  return new Promise((resolve, reject) => {
    const priorFocus = document.activeElement;
    const dialog = document.createElement('dialog');
    dialog.className = 'sii-verification';
    dialog.setAttribute('aria-labelledby', 'sii-verify-title');
    // Static markup only; provider values and errors use textContent.
    dialog.innerHTML = `<form><span class="sii-verification__badge">👾 ACCOUNT SECURITY</span>
      <h2 id="sii-verify-title">Verify it’s you</h2>
      <p>Confirm your identity before granting access. Your selections are saved on this page.</p>
      <p role="status" aria-live="polite" data-verify-status>Send a code to your verified email to continue.</p>
      <label hidden data-verify-field>Email verification code<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" /></label>
      <div class="sii-verification__actions"><button type="button" data-verify-cancel>Cancel</button><button type="submit" data-verify-submit>Send code</button></div>
    </form>`;
    const form = dialog.querySelector('form')!;
    const field = dialog.querySelector<HTMLElement>('[data-verify-field]')!;
    const input = dialog.querySelector('input')!;
    const status = dialog.querySelector<HTMLElement>('[data-verify-status]')!;
    const submit = dialog.querySelector<HTMLButtonElement>('[data-verify-submit]')!;
    let sent = false;
    let settled = false;
    const finish = (token?: string) => {
      if (settled) return;
      settled = true; dialog.close(); dialog.remove();
      if (priorFocus instanceof HTMLElement && priorFocus.isConnected) priorFocus.focus();
      if (token) resolve(token); else reject(new Error('Verification cancelled. No access was granted.'));
    };
    dialog.addEventListener('cancel', event => { event.preventDefault(); finish(); });
    dialog.querySelector('[data-verify-cancel]')!.addEventListener('click', () => finish());
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (submit.disabled || settled) return;
      submit.disabled = true;
      try {
        if (!sent) {
          const verification = await session.startVerification({ level: 'first_factor' });
          const factor = verification.supportedFirstFactors?.find(f => f.strategy === 'email_code' && f.emailAddressId);
          if (!factor?.emailAddressId) throw new Error('Email verification is unavailable. Please sign in again and retry.');
          await session.prepareFirstFactorVerification({ strategy: 'email_code', emailAddressId: factor.emailAddressId });
          if (settled) return;
          sent = true; field.hidden = false; input.required = true;
          status.textContent = `Enter the code sent to ${factor.safeIdentifier || 'your verified email'}.`;
          submit.textContent = 'Verify and continue'; input.focus();
        } else {
          const verification = await session.attemptFirstFactorVerification({ strategy: 'email_code', code: input.value.trim() });
          input.value = '';
          if (verification.status !== 'complete') throw new Error('Verification did not complete. Please retry.');
          const current = (window as unknown as { Clerk?: { session?: VerificationSession } }).Clerk?.session;
          if (current?.id !== session.id) throw new Error('Your account changed. Please retry the action.');
          const token = await session.getToken({ skipCache: true });
          if (!token) throw new Error('Please sign in again and retry.');
          finish(token);
        }
      } catch {
        if (!settled) status.textContent = sent
          ? 'That code could not be verified. Check the code and try again, or cancel and start again.'
          : 'Verification is unavailable. Please try again or sign in again.';
      } finally { if (!settled) submit.disabled = false; }
    });
    document.body.appendChild(dialog); dialog.showModal(); submit.focus();
  });
}

export async function verifiedFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const target = new URL(url, location.href);
  if (target.origin !== location.origin) throw new Error('Verification requires a same-origin action.');
  const response = await fetch(url, init);
  if (response.status !== 403) return response;
  const error: unknown = await response.clone().json().catch(() => null);
  if (!error || typeof error !== 'object' || !('error' in error) || error.error !== 'verification_required') return response;
  pending ??= reverify().finally(() => { pending = null; });
  const token = await pending;
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${token}`);
  // Retry only a server-rejected action, once. A success is never replayed.
  return fetch(url, { ...init, headers });
}

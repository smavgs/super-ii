import { analyticsChoice, experienceSurface, parseExperience, type ExperienceEvent, type ExperienceSurface } from '../lib/experience';

let sent = 0;
const counted = new Set<string>();

// No queue or retrospective replay: events before consent simply do not exist.
export function trackExperience(event: ExperienceEvent, surface = experienceSurface(location.pathname), once = false): void {
  if (!surface || analyticsChoice(document.cookie) !== 'allow' || sent >= 30 || document.visibilityState === 'hidden') return;
  const locale = document.documentElement.lang;
  const input = parseExperience({ event, surface, locale });
  const key = `${event}:${surface}`;
  if (!input || (once && counted.has(key))) return;
  counted.add(key);
  sent++;
  // referrerPolicy also keeps private paths/query strings out of this request.
  void fetch('/api/experience/events', {
    method: 'POST', credentials: 'same-origin', keepalive: true,
    referrerPolicy: 'no-referrer', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  }).catch(() => undefined);
}

export function trackCurrentPage(): void {
  const surface = experienceSurface(location.pathname);
  if (surface) trackExperience(surface === 'signup' ? 'signup_open' : surface === 'workspace' ? 'workspace_open' : 'page_open', surface, true);
}

export function installExperienceClicks(): void {
  document.addEventListener('click', event => {
    if (!experienceSurface(location.pathname)) return;
    const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
    if (!anchor || analyticsChoice(document.cookie) !== 'allow') return;
    const url = new URL(anchor.href, location.href);
    if (url.origin !== location.origin) return;
    const path = url.pathname.replace(/^\/(?:ru|zh-cn)(?=\/|$)/, '');
    const targetSurface = experienceSurface(path);
    if (url.pathname !== location.pathname && targetSurface && ['models', 'datasets', 'apps', 'robots', 'sigma'].includes(targetSurface) && path.split('/').filter(Boolean).length > 1) {
      trackExperience('resource_open', targetSurface, true);
    }
    // Explicit markers/download attributes only; never inspect a filename,
    // query string, form value, message, exception or arbitrary DOM text.
    if (anchor.hasAttribute('download') || anchor.hasAttribute('data-experience-download')) {
      const surface = experienceSurface(location.pathname);
      if (surface) trackExperience('download_click', surface as ExperienceSurface, true);
    }
  });
}

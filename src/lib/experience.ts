export const ANALYTICS_COOKIE = 'superii-analytics';
export const ANALYTICS_MAX_AGE = 60 * 60 * 24 * 180;
export type AnalyticsChoice = 'allow' | 'deny';
export const EXPERIENCE_EVENTS = ['page_open', 'handle_open', 'handle_check', 'signup_open', 'workspace_open', 'resource_open', 'download_click', 'handle_error'] as const;
export const EXPERIENCE_SURFACES = ['home', 'models', 'datasets', 'apps', 'robots', 'sigma', 'signup', 'workspace'] as const;
export type ExperienceEvent = typeof EXPERIENCE_EVENTS[number];
export type ExperienceSurface = typeof EXPERIENCE_SURFACES[number];
export type ExperienceInput = { event: ExperienceEvent; surface: ExperienceSurface; locale: 'en' | 'ru' | 'zh-CN' };

export function analyticsChoice(cookie: string): AnalyticsChoice | null {
  const value = cookie.split(';').map(part => part.trim()).find(part => part.startsWith(`${ANALYTICS_COOKIE}=`))?.slice(ANALYTICS_COOKIE.length + 1);
  return value === 'allow-v1' ? 'allow' : value === 'deny-v1' ? 'deny' : null;
}

export function experienceSurface(path: string): ExperienceSurface | null {
  const plain = path.replace(/^\/(?:ru|zh-cn)(?=\/|$)/, '') || '/';
  if (plain === '/') return 'home';
  if (/^\/sign-up(?:\/|$)/.test(plain)) return 'signup';
  if (plain === '/account') return 'workspace';
  const section = plain.split('/')[1];
  return ({ models: 'models', datasets: 'datasets', spaces: 'apps', robots: 'robots', sigma: 'sigma' } as const)[section as 'models'] ?? null;
}

export function parseExperience(value: Record<string, unknown>): ExperienceInput | null {
  if (Object.keys(value).length !== 3 || !Object.keys(value).every(key => ['event', 'surface', 'locale'].includes(key))) return null;
  const { event, surface, locale } = value;
  if (!EXPERIENCE_EVENTS.includes(event as ExperienceEvent) || !EXPERIENCE_SURFACES.includes(surface as ExperienceSurface) || typeof locale !== 'string' || !['en', 'ru', 'zh-CN'].includes(locale)) return null;
  if (String(event).startsWith('handle_') && surface !== 'home') return null;
  if (event === 'signup_open' && surface !== 'signup') return null;
  if (event === 'workspace_open' && surface !== 'workspace') return null;
  if ((event === 'resource_open' || event === 'download_click') && !['models', 'datasets', 'apps', 'robots', 'sigma'].includes(String(surface))) return null;
  return { event, surface, locale } as ExperienceInput;
}

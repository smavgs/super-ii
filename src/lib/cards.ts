export const cardPresets = ['superii', 'business', 'personal', 'conference', 'investor', 'open_source', 'custom'] as const;
export type CardPreset = typeof cardPresets[number];
export const maximumCardsPerProfile = 6;

export const cardServiceIds = [
  'email', 'phone', 'website', 'wechat', 'whatsapp', 'telegram', 'linkedin',
  'github', 'huggingface', 'qq', 'red', 'weibo',
] as const;
export type CardServiceId = typeof cardServiceIds[number];

export const verifiedBadgeIds = [
  'founding_200', 'community_leader', 'publisher', 'agent_builder',
  'robot_builder', 'transparency_contributor', 'open_source_builder',
] as const;
export type VerifiedBadgeId = typeof verifiedBadgeIds[number];

export const personalBadgeIds = [
  'ai_research', 'open_source', 'community', 'robotics', 'agents', 'builder', 'investor', 'founder',
] as const;
export type PersonalBadgeId = typeof personalBadgeIds[number];

export type LocalizedCardIdentity = {
  name: string;
  role: string;
  organization: string;
  tagline: string;
  bio: string;
};

export type CardVault = {
  identity_en: LocalizedCardIdentity;
  identity_zh: LocalizedCardIdentity;
  photo_url: string;
  email: string;
  phone: string;
  website: string;
  location: string;
  services: Partial<Record<CardServiceId, string>>;
  custom_links: Array<{ label: string; url: string }>;
};

export type CardConfig = {
  fields: Array<'photo' | 'role' | 'organization' | 'tagline' | 'bio' | 'location'>;
  services: CardServiceId[];
  custom_links: number[];
  verified_badges: VerifiedBadgeId[];
  personal_badges: PersonalBadgeId[];
  default_locale: 'en' | 'zh-CN';
  allow_share_back: boolean;
};

export type CardPublicService = {
  id: CardServiceId | 'custom';
  label: string;
  value: string;
  href: string | null;
};

export type CardPublicSnapshot = {
  version: 1;
  card_id: string;
  preset: CardPreset;
  name: string;
  identity_en: LocalizedCardIdentity;
  identity_zh: LocalizedCardIdentity | null;
  photo_url: string | null;
  location: string | null;
  services: CardPublicService[];
  verified_badges: VerifiedBadgeId[];
  personal_badges: PersonalBadgeId[];
  default_locale: 'en' | 'zh-CN';
  allow_share_back: boolean;
  published_at: string;
};

type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

const cardFieldIds = ['photo', 'role', 'organization', 'tagline', 'bio', 'location'] as const;
const cardPresetSet = new Set<string>(cardPresets);
const serviceSet = new Set<string>(cardServiceIds);
const verifiedBadgeSet = new Set<string>(verifiedBadgeIds);
const personalBadgeSet = new Set<string>(personalBadgeIds);
const cardFieldSet = new Set<string>(cardFieldIds);

export const cardPresetLabels: Record<CardPreset, string> = {
  superii: 'Super ii',
  business: 'Business',
  personal: 'Personal',
  conference: 'Conference',
  investor: 'Investor',
  open_source: 'Open Source',
  custom: 'Custom',
};

export const cardServiceLabels: Record<CardServiceId, string> = {
  email: 'Email',
  phone: 'Phone',
  website: 'Website',
  wechat: 'WeChat',
  whatsapp: 'WhatsApp',
  telegram: 'Telegram',
  linkedin: 'LinkedIn',
  github: 'GitHub',
  huggingface: 'Hugging Face',
  qq: 'QQ',
  red: 'RED',
  weibo: 'Weibo',
};

export const verifiedBadgeLabels: Record<VerifiedBadgeId, string> = {
  founding_200: 'Founding 200',
  community_leader: 'Community leader',
  publisher: 'Published builder',
  agent_builder: 'Agent builder',
  robot_builder: 'Robot builder',
  transparency_contributor: 'Transparency contributor',
  open_source_builder: 'Open-source builder',
};

export const personalBadgeLabels: Record<PersonalBadgeId, string> = {
  ai_research: 'AI research',
  open_source: 'Open source',
  community: 'Community',
  robotics: 'Robotics',
  agents: 'Agents',
  builder: 'Builder',
  investor: 'Investor',
  founder: 'Founder',
};

export const emptyCardVault = (name = ''): CardVault => ({
  identity_en: { name, role: '', organization: '', tagline: '', bio: '' },
  identity_zh: { name: '', role: '', organization: '', tagline: '', bio: '' },
  photo_url: '',
  email: '',
  phone: '',
  website: '',
  location: '',
  services: {},
  custom_links: [],
});

export const defaultCardConfig = (preset: CardPreset = 'superii'): CardConfig => ({
  fields: ['photo', 'role', 'organization', 'tagline', 'bio', 'location'],
  services: ['email', 'wechat', 'whatsapp', 'telegram', 'linkedin', 'github', 'huggingface'],
  custom_links: [],
  verified_badges: [],
  personal_badges: preset === 'open_source' ? ['open_source', 'builder'] : ['builder'],
  default_locale: 'en',
  allow_share_back: true,
});

function text(value: unknown, label: string, maximum: number, required = false): string {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string') throw new Error(`${label} must be text`);
  const result = value.trim();
  if (required && !result) throw new Error(`${label} is required`);
  if (result.length > maximum) throw new Error(`${label} must be ${maximum} characters or fewer`);
  return result;
}

function httpsUrl(value: unknown, label: string): string {
  const result = text(value, label, 2048);
  if (!result) return '';
  let url: URL;
  try { url = new URL(result); } catch { throw new Error(`${label} must be a complete HTTPS link`); }
  if (url.protocol !== 'https:' || url.username || url.password || !url.hostname) {
    throw new Error(`${label} must be a complete HTTPS link`);
  }
  return url.toString();
}

function cardPhotoUrl(value: unknown): string {
  const result = httpsUrl(value, 'Photo');
  if (!result) return '';
  const url = new URL(result);
  if (!['superii.site', 'www.superii.site', 'img.clerk.com'].includes(url.hostname.toLowerCase())) {
    throw new Error('Photo must use your Super ii profile image or an approved Super ii image');
  }
  return result;
}

export function publicCardPhotoSource(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (
      ['superii.site', 'www.superii.site'].includes(url.hostname.toLowerCase())
      && /^\/card-images\/[0-9a-f-]{36}\.jpg$/iu.test(url.pathname)
    ) return url.pathname;
  } catch {
    return null;
  }
  return value;
}

export function validEmailAddress(value: string): boolean {
  return /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/iu.test(value);
}

function localizedIdentity(value: unknown, label: string, requireName: boolean): LocalizedCardIdentity {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return {
    name: text(input.name, `${label} name`, 100, requireName),
    role: text(input.role, `${label} role`, 120),
    organization: text(input.organization, `${label} organization`, 120),
    tagline: text(input.tagline, `${label} tagline`, 180),
    bio: text(input.bio, `${label} bio`, 500),
  };
}

function uniqueEnum<T extends string>(value: unknown, allowed: Set<string>, label: string, maximum: number): T[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be a list`);
  const result: T[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || !allowed.has(item)) throw new Error(`${label} contains an unsupported value`);
    if (!result.includes(item as T)) result.push(item as T);
  }
  if (result.length > maximum) throw new Error(`${label} has too many values`);
  return result;
}

export function parseCardVault(payload: Record<string, unknown>): ParseResult<CardVault> {
  const allowed = new Set(['identity_en', 'identity_zh', 'photo_url', 'email', 'phone', 'website', 'location', 'services', 'custom_links']);
  const unknown = Object.keys(payload).find((key) => !allowed.has(key));
  if (unknown) return { ok: false, error: `Unknown contact field: ${unknown}` };
  try {
    const rawServices = payload.services && typeof payload.services === 'object' && !Array.isArray(payload.services)
      ? payload.services as Record<string, unknown> : {};
    const services: Partial<Record<CardServiceId, string>> = {};
    for (const [key, value] of Object.entries(rawServices)) {
      if (!serviceSet.has(key)) throw new Error(`Unsupported contact service: ${key}`);
      if (['email', 'phone', 'website'].includes(key)) throw new Error(`${cardServiceLabels[key as CardServiceId]} belongs in core contact details`);
      const normalized = text(value, cardServiceLabels[key as CardServiceId], 240);
      const service = key as CardServiceId;
      if (normalized && ['whatsapp', 'telegram', 'linkedin', 'github', 'huggingface'].includes(service) && !serviceHref(service, normalized)) {
        throw new Error(`${cardServiceLabels[service]} must be a valid handle, number, or official service link`);
      }
      if (normalized && /^https?:/iu.test(normalized) && ['red', 'weibo'].includes(service) && !serviceHref(service, normalized)) {
        throw new Error(`${cardServiceLabels[service]} must use an official service link`);
      }
      if (normalized) services[key as CardServiceId] = normalized;
    }
    const rawLinks = Array.isArray(payload.custom_links) ? payload.custom_links : [];
    if (rawLinks.length > 5) throw new Error('Add no more than 5 custom links');
    const customLinks = rawLinks.map((item, index) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`Custom link ${index + 1} is invalid`);
      const input = item as Record<string, unknown>;
      return { label: text(input.label, `Custom link ${index + 1} label`, 40, true), url: httpsUrl(input.url, `Custom link ${index + 1}`) };
    });
    const email = text(payload.email, 'Email', 254);
    if (email && !validEmailAddress(email)) throw new Error('Email must be a valid address');
    return { ok: true, value: {
      identity_en: localizedIdentity(payload.identity_en, 'English', true),
      identity_zh: localizedIdentity(payload.identity_zh, 'Chinese', false),
      photo_url: cardPhotoUrl(payload.photo_url),
      email,
      phone: text(payload.phone, 'Phone', 40),
      website: httpsUrl(payload.website, 'Website'),
      location: text(payload.location, 'Location', 120),
      services,
      custom_links: customLinks,
    } };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Contact details are invalid' };
  }
}

export function parseCardConfig(payload: unknown): ParseResult<CardConfig> {
  const input = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
  try {
    const indices = Array.isArray(input.custom_links) ? input.custom_links : [];
    const customLinks = indices.map((value) => {
      if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 4) throw new Error('Custom link selection is invalid');
      return Number(value);
    });
    return { ok: true, value: {
      fields: uniqueEnum<CardConfig['fields'][number]>(input.fields ?? defaultCardConfig().fields, cardFieldSet, 'Card fields', cardFieldIds.length),
      services: uniqueEnum<CardServiceId>(input.services ?? defaultCardConfig().services, serviceSet, 'Services', cardServiceIds.length),
      custom_links: [...new Set(customLinks)],
      verified_badges: uniqueEnum<VerifiedBadgeId>(input.verified_badges ?? [], verifiedBadgeSet, 'Verified badges', verifiedBadgeIds.length),
      personal_badges: uniqueEnum<PersonalBadgeId>(input.personal_badges ?? [], personalBadgeSet, 'Personal badges', 4),
      default_locale: input.default_locale === 'zh-CN' ? 'zh-CN' : 'en',
      allow_share_back: input.allow_share_back !== false,
    } };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Card settings are invalid' };
  }
}

export function parseCardCreate(payload: Record<string, unknown>): ParseResult<{ name: string; preset: CardPreset }> {
  try {
    const name = text(payload.name, 'Card name', 80, true);
    const preset = typeof payload.preset === 'string' && cardPresetSet.has(payload.preset)
      ? payload.preset as CardPreset : 'custom';
    return { ok: true, value: { name, preset } };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Card is invalid' };
  }
}

export function serviceHref(id: CardServiceId, value: string): string | null {
  const clean = value.trim();
  if (!clean) return null;
  if (id === 'email') return validEmailAddress(clean) ? `mailto:${clean}` : null;
  if (id === 'phone') {
    const phone = clean.replace(/(?!^)\+|[^+\d]/gu, '');
    return /\d/u.test(phone) ? `tel:${phone}` : null;
  }
  if (id === 'website') return safeHttps(clean);
  if (id === 'whatsapp') {
    const direct = officialHttps(clean, ['wa.me', 'whatsapp.com']);
    if (direct) return direct;
    if (/^https?:/iu.test(clean)) return null;
    const digits = clean.replace(/\D/gu, '');
    return digits ? `https://wa.me/${digits}` : null;
  }
  if (id === 'telegram') return handleUrl(clean, 'https://t.me/', ['t.me', 'telegram.me']);
  if (id === 'github') return handleUrl(clean, 'https://github.com/', ['github.com']);
  if (id === 'huggingface') return handleUrl(clean, 'https://huggingface.co/', ['huggingface.co']);
  if (id === 'linkedin') return handleUrl(clean, 'https://www.linkedin.com/in/', ['linkedin.com']);
  if (id === 'red') return officialHttps(clean, ['xiaohongshu.com', 'xhslink.com']);
  if (id === 'weibo') return officialHttps(clean, ['weibo.com', 'weibo.cn']);
  return null;
}

function safeHttps(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : null;
  } catch { return null; }
}

function officialHttps(value: string, hosts: string[]): string | null {
  const direct = safeHttps(value);
  if (!direct) return null;
  const hostname = new URL(direct).hostname.toLowerCase();
  return hosts.some((host) => hostname === host || hostname.endsWith(`.${host}`)) ? direct : null;
}

function handleUrl(value: string, base: string, hosts: string[]): string | null {
  const direct = officialHttps(value, hosts);
  if (direct) return direct;
  if (/^https?:/iu.test(value)) return null;
  const handle = value.replace(/^@/u, '').trim();
  return /^[\p{L}\p{N}_.-]{1,100}$/u.test(handle) ? `${base}${encodeURIComponent(handle)}` : null;
}

function hasChineseIdentity(identity: LocalizedCardIdentity): boolean {
  return identity.name.trim().length > 0;
}

export function buildPublicCardSnapshot(input: {
  cardId: string;
  cardName: string;
  preset: CardPreset;
  config: CardConfig;
  vault: CardVault;
  eligibleBadges: VerifiedBadgeId[];
  publishedAt?: string;
}): CardPublicSnapshot {
  const selectedBadges = input.config.verified_badges.filter((badge) => input.eligibleBadges.includes(badge));
  const selectedServices: CardPublicService[] = [];
  for (const id of input.config.services) {
    const fallback = id === 'email' ? input.vault.email : id === 'phone' ? input.vault.phone : id === 'website' ? input.vault.website : '';
    const value = input.vault.services[id] ?? fallback;
    if (!value) continue;
    selectedServices.push({ id, label: cardServiceLabels[id], value, href: serviceHref(id, value) });
  }
  for (const index of input.config.custom_links) {
    const link = input.vault.custom_links[index];
    if (link) selectedServices.push({ id: 'custom', label: link.label, value: link.url, href: link.url });
  }
  const cleanIdentity = (identity: LocalizedCardIdentity): LocalizedCardIdentity => ({
    name: identity.name,
    role: input.config.fields.includes('role') ? identity.role : '',
    organization: input.config.fields.includes('organization') ? identity.organization : '',
    tagline: input.config.fields.includes('tagline') ? identity.tagline : '',
    bio: input.config.fields.includes('bio') ? identity.bio : '',
  });
  const identityZh = hasChineseIdentity(input.vault.identity_zh) ? cleanIdentity(input.vault.identity_zh) : null;
  return {
    version: 1,
    card_id: input.cardId,
    preset: input.preset,
    name: input.cardName,
    identity_en: cleanIdentity(input.vault.identity_en),
    identity_zh: identityZh,
    photo_url: input.config.fields.includes('photo') && input.vault.photo_url ? input.vault.photo_url : null,
    location: input.config.fields.includes('location') && input.vault.location ? input.vault.location : null,
    services: selectedServices,
    verified_badges: selectedBadges,
    personal_badges: input.config.personal_badges,
    default_locale: input.config.default_locale === 'zh-CN' && identityZh ? 'zh-CN' : 'en',
    allow_share_back: input.config.allow_share_back,
    published_at: input.publishedAt ?? new Date().toISOString(),
  };
}

export function cardVcard(snapshot: CardPublicSnapshot, locale: 'en' | 'zh-CN' = 'en'): string {
  const identity = locale === 'zh-CN' && snapshot.identity_zh ? snapshot.identity_zh : snapshot.identity_en;
  const escape = (value: string) => value.replaceAll('\\', '\\\\').replace(/\r?\n|\r/gu, '\\n').replaceAll(',', '\\,').replaceAll(';', '\\;');
  const lines = ['BEGIN:VCARD', 'VERSION:4.0', 'KIND:individual', `FN:${escape(identity.name)}`];
  if (identity.organization) lines.push(`ORG:${escape(identity.organization)}`);
  if (identity.role) lines.push(`TITLE:${escape(identity.role)}`);
  if (identity.bio || identity.tagline) lines.push(`NOTE:${escape([identity.tagline, identity.bio].filter(Boolean).join(' — '))}`);
  if (snapshot.location) lines.push(`ADR:;;;;;;${escape(snapshot.location)}`);
  if (snapshot.photo_url) lines.push(`PHOTO:${snapshot.photo_url}`);
  for (const service of snapshot.services) {
    if (service.id === 'email') lines.push(`EMAIL:${escape(service.value)}`);
    else if (service.id === 'phone' && service.href?.startsWith('tel:')) lines.push(`TEL;VALUE=uri:${service.href}`);
    else if (service.id === 'whatsapp' && service.href?.startsWith('https://')) lines.push(`IMPP:${service.href}`);
    else if (service.href?.startsWith('https://')) lines.push(`URL;TYPE=${service.label.toUpperCase().replace(/[^A-Z0-9]/gu, '')}:${escape(service.href)}`);
    else lines.push(`X-SUPERII-${service.label.toUpperCase().replace(/[^A-Z0-9]/gu, '')}:${escape(service.value)}`);
  }
  lines.push(`REV:${snapshot.published_at}`);
  lines.push('END:VCARD');
  const encoder = new TextEncoder();
  const fold = (line: string): string => {
    const folded: string[] = [];
    let current = '';
    let bytes = 0;
    for (const character of line) {
      const length = encoder.encode(character).byteLength;
      if (current && bytes + length > 75) {
        folded.push(current);
        current = ` ${character}`;
        bytes = 1 + length;
      } else {
        current += character;
        bytes += length;
      }
    }
    folded.push(current);
    return folded.join('\r\n');
  };
  return `${lines.map(fold).join('\r\n')}\r\n`;
}

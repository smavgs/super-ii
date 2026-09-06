export type EditableMemberProfile = {
  bio: string | null;
  interests: string[];
  x_username: string | null;
  github_username: string | null;
  linkedin_url: string | null;
  website_url: string | null;
  youtube_url: string | null;
};

export type MemberProfileParseResult =
  | { ok: true; value: EditableMemberProfile }
  | { ok: false; error: string };

const allowedKeys = new Set([
  'bio',
  'interests',
  'x_username',
  'github_username',
  'linkedin_url',
  'website_url',
  'youtube_url',
]);
const xUsernamePattern = /^[A-Za-z0-9_]{1,50}$/;
const githubUsernamePattern = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;

function optionalText(value: unknown, label: string, maxLength: number): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') throw new Error(`${label} must be text`);
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.length > maxLength) throw new Error(`${label} must be ${maxLength} characters or fewer`);
  return normalized;
}

function optionalUsername(
  value: unknown,
  label: string,
  pattern: RegExp,
): string | null {
  const normalized = optionalText(value, label, 64)?.replace(/^@/, '') ?? null;
  if (normalized !== null && !pattern.test(normalized)) {
    throw new Error(`${label} is not a valid username`);
  }
  return normalized;
}

function optionalHttpsUrl(
  value: unknown,
  label: string,
  allowedHost?: (hostname: string) => boolean,
): string | null {
  const normalized = optionalText(value, label, 2048);
  if (!normalized) return null;
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error(`${label} must be a complete HTTPS link`);
  }
  const hostname = url.hostname.toLowerCase();
  if (
    url.protocol !== 'https:'
    || url.username
    || url.password
    || !hostname
    || (allowedHost && !allowedHost(hostname))
  ) {
    throw new Error(`${label} must be a valid HTTPS link`);
  }
  return url.toString();
}

function parseInterests(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error('Interests must be a list');
  if (value.length > 12) throw new Error('Add no more than 12 interests');
  const interests: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') throw new Error('Each interest must be text');
    const interest = item.trim();
    if (!interest || interest.length > 80) {
      throw new Error('Each interest must be between 1 and 80 characters');
    }
    const key = interest.toLocaleLowerCase('en-US');
    if (seen.has(key)) continue;
    seen.add(key);
    interests.push(interest);
  }
  return interests;
}

const linkedinHost = (hostname: string) => hostname === 'linkedin.com' || hostname.endsWith('.linkedin.com');
const youtubeHost = (hostname: string) => hostname === 'youtube.com' || hostname.endsWith('.youtube.com') || hostname === 'youtu.be';

export function parseEditableMemberProfile(payload: Record<string, unknown>): MemberProfileParseResult {
  const unknownKey = Object.keys(payload).find((key) => !allowedKeys.has(key));
  if (unknownKey) return { ok: false, error: `Unknown profile field: ${unknownKey}` };
  try {
    return {
      ok: true,
      value: {
        bio: optionalText(payload.bio, 'Bio', 500),
        interests: parseInterests(payload.interests),
        x_username: optionalUsername(payload.x_username, 'X username', xUsernamePattern),
        github_username: optionalUsername(payload.github_username, 'GitHub username', githubUsernamePattern),
        linkedin_url: optionalHttpsUrl(payload.linkedin_url, 'LinkedIn', linkedinHost),
        website_url: optionalHttpsUrl(payload.website_url, 'Website'),
        youtube_url: optionalHttpsUrl(payload.youtube_url, 'YouTube', youtubeHost),
      },
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Profile is invalid' };
  }
}

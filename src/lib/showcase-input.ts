export const showcaseMaximumBytes = 600_000;
export const showcaseMaximumSourceBytes = 16 * 1024 * 1024;
// Keep a fixed operational reserve below the provider storage boundary.
export const showcaseStorageCeilingBytes = 7_500_000_000;

export function optionalShowcaseUrl(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || value.length > 2_048) throw new Error('Link must be a complete HTTPS URL');
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('Link must be a complete HTTPS URL'); }
  if (url.protocol !== 'https:' || url.username || url.password || !url.hostname) {
    throw new Error('Link must be a complete HTTPS URL');
  }
  return url.toString();
}

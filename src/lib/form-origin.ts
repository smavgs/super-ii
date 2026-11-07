const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);
const formTypes = ['application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain'];

/** Preserve Astro's form-origin boundary, with one token-authorized server callback. */
export async function formOriginDenied(
  request: Request,
  validateUnsubscribeToken: (token: string) => Promise<boolean>,
): Promise<boolean> {
  if (safeMethods.has(request.method)) return false;
  const url = new URL(request.url);
  if (request.headers.get('origin') === url.origin) return false;
  const contentType = request.headers.get('content-type');
  if (contentType && !formTypes.some((type) => contentType.toLowerCase().includes(type))) return false;

  // RFC 8058 clients have no browser Origin. This exception cannot dispatch an
  // Astro action, accept a browser cross-site form, or authorize through cookies.
  if (
    request.method !== 'POST' || url.pathname !== '/api/sigma/subscription' ||
    request.headers.has('origin') || request.headers.has('sec-fetch-site') ||
    contentType?.split(';')[0] !== 'application/x-www-form-urlencoded' ||
    [...url.searchParams.keys()].length !== 1 || !url.searchParams.has('token')
  ) return true;
  const token = url.searchParams.get('token')!;
  if (!/^[a-f0-9-]{36}\.[a-f0-9-]{36}\.[a-f0-9]{64}$/.test(token)) return true;
  try {
    return !(await validateUnsubscribeToken(token));
  } catch {
    return true;
  }
}

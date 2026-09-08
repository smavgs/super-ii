export type RecipeRole = 'generator' | 'embedding' | 'dataset';
const roles: RecipeRole[] = ['generator', 'embedding', 'dataset'];

/** Resolve one input with its own read credential, without forwarding other inputs. */
export function recipeInputRequest(request: Request, role: RecipeRole, url = request.url): Request {
  if (new URL(url).origin !== new URL(request.url).origin) throw new Error('Recipe inputs must stay on origin');
  const token = request.headers.get(`x-superii-${role}-token`);
  const headers = new Headers(request.headers);
  for (const input of roles) headers.delete(`x-superii-${input}-token`);
  if (token !== null) {
    if (!/^sii_(?:agent_)?[a-z0-9]{40,128}$/.test(token)) throw new Error('Invalid recipe input credential');
    headers.set('authorization', `Bearer ${token}`);
    headers.delete('cookie');
  }
  return new Request(url, { headers });
}

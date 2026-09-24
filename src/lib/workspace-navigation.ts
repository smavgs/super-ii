export const workspaceSections = ['work', 'setup', 'agents', 'commerce', 'account'] as const;
export type WorkspaceSection = typeof workspaceSections[number];

export type WorkspaceDestination = {
  section: WorkspaceSection;
  target?: string;
  redirect?: string;
};

/** Keep bookmarks and Clerk's nested account routes working after the layout change. */
export function workspaceDestination(hash: string, welcome: string | null = null): WorkspaceDestination {
  if (welcome === 'ai-worker') return { section: 'setup', target: 'ai-worker' };
  const target = hash.replace(/^#/, '');
  const moved: Record<string, string> = {
    robots: '/robot#my-robots',
    hardware: '/robot#hardware',
    'robot-maintenance': '/robot#robot-maintenance',
    transparent: '/transparent#my-reports',
    organizations: '/organizations#my-organizations',
    chats: '/chats',
    plans: '/pricing',
  };
  if (Object.hasOwn(moved, target)) return { section: 'work', redirect: moved[target] };
  if (['agent-starter', 'ai-worker', 'connect-super-ii', 'connect-super-ii-worker'].includes(target)) {
    return { section: 'setup', target };
  }
  if (['profile', 'identity', 'billing'].includes(target)) return { section: 'account', target };
  if (target.startsWith('/')) return { section: 'account', target: 'identity' };
  if (['repositories', 'activity', 'imports'].includes(target)) return { section: 'work', target };
  return { section: workspaceSections.includes(target as WorkspaceSection) ? target as WorkspaceSection : 'work' };
}

export function repositoryMatches(text: string, kind: string, query: string, filter: string): boolean {
  const normalize = (value: string) => value.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase().trim();
  return (filter === 'all' || kind === filter) && normalize(text).includes(normalize(query));
}

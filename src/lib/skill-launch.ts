export type LaunchGroup = 'chat' | 'code';
export type LaunchTarget = {
  id: string;
  name: string;
  group: LaunchGroup;
  mode: 'url' | 'copy' | 'deeplink';
  asset?: string;
  icon?: string;
  openUrl: string;
  makeUrl?: (prompt: string) => string;
};

// Keep one entry per general-purpose tool. Unsupported query parameters and
// specialist project generators do not belong in an all-skills launcher.
export const launchTargets: LaunchTarget[] = [
  { id: 'chatgpt', name: 'ChatGPT', group: 'chat', mode: 'url', asset: '/brand/agents/codex.svg', openUrl: 'https://chatgpt.com/', makeUrl: p => `https://chatgpt.com/?q=${encodeURIComponent(p)}` },
  { id: 'claude', name: 'Claude', group: 'chat', mode: 'url', asset: '/brand/agents/claude-code.svg', openUrl: 'https://claude.ai/new', makeUrl: p => `https://claude.ai/new?q=${encodeURIComponent(p)}` },
  { id: 'grok', name: 'Grok', group: 'chat', mode: 'url', asset: '/brand/agents/grok.svg', openUrl: 'https://grok.com/chat', makeUrl: p => `https://grok.com/chat?q=${encodeURIComponent(p)}` },
  { id: 'gemini', name: 'Gemini', group: 'chat', mode: 'copy', openUrl: 'https://gemini.google.com/app' },
  { id: 'copilot', name: 'Microsoft Copilot', group: 'chat', mode: 'copy', asset: '/brand/agents/copilot.svg', openUrl: 'https://copilot.microsoft.com/' },
  { id: 'deepseek', name: 'DeepSeek', group: 'chat', mode: 'copy', openUrl: 'https://chat.deepseek.com/' },
  { id: 'codex', name: 'Codex', group: 'code', mode: 'deeplink', asset: '/brand/agents/codex.svg', openUrl: 'https://chatgpt.com/codex', makeUrl: p => `codex://new?prompt=${encodeURIComponent(p)}` },
  { id: 'cursor', name: 'Cursor', group: 'code', mode: 'url', openUrl: 'https://cursor.com/link/prompt', makeUrl: p => `https://cursor.com/link/prompt?text=${encodeURIComponent(p)}` },
];

// Measure the complete encoded URL, including nested redirect encoding. This
// stays below Cursor's documented 10,000-character limit and never truncates.
export const MAX_HANDOFF_URL_LENGTH = 8_000;
export function planSkillLaunch(target: LaunchTarget, prompt: string, mobile = false) {
  let url: string | undefined;
  try { url = target.makeUrl?.(prompt); } catch { /* Clipboard preserves text that cannot be URL encoded. */ }
  const direct = Boolean(url && url.length <= MAX_HANDOFF_URL_LENGTH && !(mobile && target.mode === 'deeplink'));
  return {
    url: direct ? url! : target.openUrl,
    native: direct && target.mode === 'deeplink',
    requiresPaste: !direct,
    reason: !direct && url && url.length > MAX_HANDOFF_URL_LENGTH ? 'long' : 'copy',
  } as const;
}

export type SkillLaunchHost = {
  copy: (prompt: string) => Promise<boolean>;
  open: (url: string) => boolean;
  openNative: (url: string) => void;
};

export async function dispatchSkillLaunch(target: LaunchTarget, prompt: string, host: SkillLaunchHost, mobile = false) {
  const plan = planSkillLaunch(target, prompt, mobile);
  // Invoke clipboard and navigation in the original click, before awaiting
  // permission. A pending clipboard promise must never suppress navigation.
  const copying = host.copy(prompt).catch(() => false);
  let blocked = false;
  try {
    if (plan.native) host.openNative(plan.url);
    else blocked = !host.open(plan.url);
  } catch { blocked = true; }
  return { plan, blocked, copied: await copying };
}

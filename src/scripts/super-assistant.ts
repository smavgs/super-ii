type FailureKind = 'auth' | 'limited' | 'search-limited' | 'unavailable';

type AssistantMessage = {
  role: 'user' | 'assistant';
  content: string;
};

type AssistantSource = {
  title: string;
  url: string;
  source: string;
};

type AssistantReply = {
  answer: string;
  sources: AssistantSource[];
  searched: boolean;
};

export type AssistantSkillContext = {
  name: string;
  category: string;
  integrations: string[];
  prompt: string;
};

export type SuperAssistantController = {
  toggle: () => void;
  openSkillSetup: (context: AssistantSkillContext) => void;
  destroy: () => void;
};

class AssistantConnectionError extends Error {
  constructor(readonly kind: FailureKind) {
    super(kind);
    this.name = 'AssistantConnectionError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizedSkillContext(value: unknown): AssistantSkillContext | null {
  if (!isRecord(value)
    || typeof value.name !== 'string'
    || !value.name.trim()
    || value.name.length > 120
    || typeof value.category !== 'string'
    || !value.category.trim()
    || value.category.length > 80
    || !Array.isArray(value.integrations)
    || value.integrations.length > 12
    || value.integrations.some((item) => typeof item !== 'string' || !item.trim() || item.length > 80)
    || typeof value.prompt !== 'string'
    || !value.prompt.trim()
    || value.prompt.length > 8_000) return null;
  return {
    name: value.name.trim(),
    category: value.category.trim(),
    integrations: value.integrations.map((item) => (item as string).trim()),
    prompt: value.prompt,
  };
}

function assistantSources(value: unknown): AssistantSource[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 5).flatMap((item) => {
    if (!isRecord(item)
      || typeof item.title !== 'string'
      || typeof item.url !== 'string'
      || typeof item.source !== 'string') return [];
    try {
      const url = new URL(item.url);
      if (!['http:', 'https:'].includes(url.protocol)) return [];
      return [{
        title: item.title.trim().slice(0, 240),
        url: url.toString(),
        source: item.source.trim().slice(0, 120),
      }];
    } catch {
      return [];
    }
  }).filter((item) => item.title && item.source);
}

async function requestAssistant(
  messages: AssistantMessage[],
  webSearch: boolean,
  skillContext: AssistantSkillContext | null,
  signal: AbortSignal,
): Promise<AssistantReply> {
  let response: Response;
  try {
    response = await fetch('/api/assistant/chat', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      credentials: 'same-origin',
      body: JSON.stringify({
        messages,
        web_search: webSearch,
        ...(skillContext ? { skill_context: skillContext } : {}),
      }),
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new AssistantConnectionError('unavailable');
  }

  const payload: unknown = await response.json().catch(() => null);
  if (response.status === 401) throw new AssistantConnectionError('auth');
  if (response.status === 429) {
    const kind = isRecord(payload) && payload.code === 'search_limit_reached'
      ? 'search-limited'
      : 'limited';
    throw new AssistantConnectionError(kind);
  }
  if (!response.ok || !isRecord(payload) || typeof payload.answer !== 'string' || !payload.answer.trim()) {
    throw new AssistantConnectionError('unavailable');
  }

  return {
    answer: payload.answer.trim(),
    sources: assistantSources(payload.sources),
    searched: isRecord(payload.search) && payload.search.performed === true,
  };
}

function boundedHistory(messages: AssistantMessage[]): AssistantMessage[] {
  const history = [...messages];
  const totalChars = () => history.reduce((total, message) => total + message.content.length, 0);
  while ((history.length > 12 || totalChars() > 12_000) && history.length > 2) history.splice(0, 2);
  return history;
}

export function createSuperAssistant(root: HTMLElement): SuperAssistantController {
  function requireElement<T>(selector: string, label: string): T {
    const element = root.querySelector(selector);
    if (!element) throw new Error(`Assistant ${label} is missing.`);
    return element as unknown as T;
  }

  const launcher = requireElement<HTMLButtonElement>('button[data-super-assistant-launcher]', 'launcher');
  const panel = requireElement<HTMLElement>('section[data-super-assistant-panel]', 'panel');
  const closeButton = requireElement<HTMLButtonElement>('button[data-super-assistant-close]', 'close button');
  const status = requireElement<HTMLElement>('[data-super-assistant-status]', 'status');
  const messages = requireElement<HTMLElement>('[data-super-assistant-messages]', 'messages');
  const notice = requireElement<HTMLElement>('[data-super-assistant-notice]', 'notice');
  const noticeCopy = requireElement<HTMLElement>('[data-super-assistant-notice-copy]', 'notice copy');
  const authActions = requireElement<HTMLElement>('[data-super-assistant-auth-actions]', 'account actions');
  const retryButton = requireElement<HTMLButtonElement>('[data-super-assistant-retry]', 'retry button');
  const form = requireElement<HTMLFormElement>('form[data-super-assistant-form]', 'form');
  const input = requireElement<HTMLTextAreaElement>('textarea[data-super-assistant-input]', 'input');
  const searchButton = requireElement<HTMLButtonElement>('button[data-super-assistant-web-search]', 'web search button');
  const sendButton = requireElement<HTMLButtonElement>('button[data-super-assistant-send]', 'send button');

  let open = false;
  let destroyed = false;
  let awaitingResponse = false;
  let webSearchEnabled = false;
  let activeRequest: AbortController | null = null;
  let currentMessage: HTMLElement | null = null;
  let currentCopy: HTMLParagraphElement | null = null;
  let skillContext: AssistantSkillContext | null = null;
  const conversation: AssistantMessage[] = [];

  function setStatus(copy: string, state = '') {
    status.textContent = copy;
    status.dataset.state = state;
  }

  function setComposerReady(ready: boolean) {
    form.setAttribute('aria-busy', String(!ready));
    input.disabled = !ready;
    searchButton.disabled = !ready || awaitingResponse;
    sendButton.disabled = !ready || awaitingResponse || !input.value.trim();
  }

  function renderSearchState() {
    searchButton.setAttribute('aria-pressed', String(webSearchEnabled));
    searchButton.setAttribute('aria-label', webSearchEnabled ? 'Turn web search off' : 'Turn web search on');
  }

  function setWebSearch(enabled: boolean) {
    webSearchEnabled = enabled;
    renderSearchState();
    if (!awaitingResponse) setStatus(enabled ? 'Web search on' : 'Ready', enabled ? 'search' : 'ready');
  }

  function hideNotice() {
    notice.hidden = true;
    authActions.hidden = true;
    retryButton.hidden = true;
  }

  function showFailure(kind: FailureKind) {
    notice.hidden = false;
    authActions.hidden = kind !== 'auth';
    retryButton.hidden = kind === 'auth' || kind === 'search-limited';

    if (kind === 'search-limited') {
      setWebSearch(false);
      setComposerReady(true);
      setStatus('Daily web searches used', 'attention');
      noticeCopy.textContent = 'Your daily web-search allowance is used. You can keep chatting with web search off.';
      if (open) input.focus();
      return;
    }

    setComposerReady(false);
    if (kind === 'auth') {
      setStatus('Sign in to chat', 'attention');
      noticeCopy.textContent = 'Create a free account or log in to start a private browser session.';
      return;
    }
    if (kind === 'limited') {
      setStatus('Usage limit reached', 'attention');
      noticeCopy.textContent = 'The free assistant has reached its current usage limit. Please try again later.';
      return;
    }
    setStatus('Temporarily unavailable', 'attention');
    noticeCopy.textContent = 'The assistant could not connect just now.';
  }

  function resetFailure() {
    hideNotice();
    setStatus(webSearchEnabled ? 'Web search on' : 'Ready', webSearchEnabled ? 'search' : 'ready');
    setComposerReady(true);
    if (open) input.focus();
  }

  function scrollMessages() {
    messages.scrollTo({ top: messages.scrollHeight, behavior: 'smooth' });
  }

  function addMessage(role: 'user' | 'assistant', copy: string) {
    const article = document.createElement('article');
    article.className = `super-assistant__message super-assistant__message--${role}`;
    const label = document.createElement('span');
    label.className = 'sr-only';
    label.textContent = role === 'user' ? 'You:' : 'Super ii:';
    const paragraph = document.createElement('p');
    paragraph.textContent = copy;
    article.appendChild(label);
    article.appendChild(paragraph);
    messages.appendChild(article);
    scrollMessages();
  }

  function beginAssistantMessage() {
    const article = document.createElement('article');
    article.className = 'super-assistant__message super-assistant__message--assistant';
    const label = document.createElement('span');
    label.className = 'sr-only';
    label.textContent = 'Super ii:';
    const paragraph = document.createElement('p');
    const thinking = document.createElement('span');
    thinking.className = 'super-assistant__thinking';
    thinking.setAttribute('aria-label', 'Super ii is thinking');
    for (let index = 0; index < 3; index += 1) thinking.appendChild(document.createElement('i'));
    paragraph.appendChild(thinking);
    article.appendChild(label);
    article.appendChild(paragraph);
    messages.appendChild(article);
    currentMessage = article;
    currentCopy = paragraph;
    scrollMessages();
  }

  function appendSources(article: HTMLElement, sources: AssistantSource[]) {
    if (!sources.length) return;
    const sourceList = document.createElement('div');
    sourceList.className = 'super-assistant__sources';
    const label = document.createElement('span');
    label.textContent = 'Sources';
    sourceList.appendChild(label);
    sources.forEach((source, index) => {
      const link = document.createElement('a');
      link.href = source.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = `${index + 1} · ${source.source}`;
      link.title = source.title;
      sourceList.appendChild(link);
    });
    article.appendChild(sourceList);
  }

  function finishAssistantMessage(reply: AssistantReply) {
    if (currentCopy) currentCopy.textContent = reply.answer;
    if (currentMessage) appendSources(currentMessage, reply.sources);
    currentMessage = null;
    currentCopy = null;
    awaitingResponse = false;
    activeRequest = null;
    setComposerReady(true);
    setStatus(reply.searched ? 'Web checked' : (webSearchEnabled ? 'Web search on' : 'Ready'), reply.searched || webSearchEnabled ? 'search' : 'ready');
    scrollMessages();
    if (open) input.focus();
  }

  function discardAssistantMessage() {
    currentMessage?.remove();
    currentMessage = null;
    currentCopy = null;
    awaitingResponse = false;
    activeRequest = null;
  }

  function resizeInput() {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 112)}px`;
    sendButton.disabled = input.disabled || !input.value.trim() || awaitingResponse;
  }

  function openPanel() {
    open = true;
    panel.hidden = false;
    root.dataset.open = 'true';
    launcher.setAttribute('aria-expanded', 'true');
    if (!awaitingResponse) resetFailure();
    window.requestAnimationFrame(() => (input.disabled ? closeButton : input).focus());
  }

  function closePanel() {
    open = false;
    panel.hidden = true;
    delete root.dataset.open;
    launcher.setAttribute('aria-expanded', 'false');
    launcher.focus();
  }

  function toggle() {
    if (open) closePanel();
    else openPanel();
  }

  function openSkillSetup(context: AssistantSkillContext) {
    const nextContext = normalizedSkillContext(context);
    if (!nextContext) return;
    activeRequest?.abort();
    activeRequest = null;
    awaitingResponse = false;
    currentMessage = null;
    currentCopy = null;
    conversation.splice(0, conversation.length);
    messages.replaceChildren();
    skillContext = nextContext;
    input.value = '';
    input.placeholder = 'Tell me which agent you use…';
    resizeInput();
    hideNotice();
    addMessage(
      'assistant',
      `I’ll help you set up ${nextContext.name}. First, let’s check which agent you’re using and which integrations you already have connected.`,
    );
    if (!open) openPanel();
    setStatus('Skill setup ready', 'ready');
    setComposerReady(true);
    input.focus();
  }

  async function submit() {
    const copy = input.value.trim();
    if (!copy || awaitingResponse) return;
    hideNotice();
    input.value = '';
    resizeInput();
    addMessage('user', copy);
    beginAssistantMessage();
    awaitingResponse = true;
    setComposerReady(false);
    setStatus(webSearchEnabled ? 'Checking the web…' : 'Thinking…', webSearchEnabled ? 'search' : '');

    const pendingHistory = boundedHistory([...conversation, { role: 'user', content: copy }]);
    const controller = new AbortController();
    activeRequest = controller;
    try {
      const reply = await requestAssistant(pendingHistory, webSearchEnabled, skillContext, controller.signal);
      if (destroyed) return;
      conversation.splice(0, conversation.length, ...boundedHistory([
        ...pendingHistory,
        { role: 'assistant', content: reply.answer },
      ]));
      finishAssistantMessage(reply);
    } catch (error) {
      if (destroyed || (error instanceof DOMException && error.name === 'AbortError')) return;
      discardAssistantMessage();
      showFailure(error instanceof AssistantConnectionError ? error.kind : 'unavailable');
    }
  }

  closeButton.addEventListener('click', closePanel);
  retryButton.addEventListener('click', resetFailure);
  searchButton.addEventListener('click', () => {
    hideNotice();
    setWebSearch(!webSearchEnabled);
    input.focus();
  });
  input.addEventListener('input', resizeInput);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void submit();
  });

  const onKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && open) closePanel();
  };
  const destroy = () => {
    destroyed = true;
    activeRequest?.abort();
    activeRequest = null;
    document.removeEventListener('keydown', onKeydown);
    window.removeEventListener('pagehide', destroy);
  };
  renderSearchState();
  document.addEventListener('keydown', onKeydown);
  window.addEventListener('pagehide', destroy);

  return { toggle, openSkillSetup, destroy };
}

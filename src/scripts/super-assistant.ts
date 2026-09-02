type FailureKind = 'auth' | 'limited' | 'unavailable';

type AssistantMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export type SuperAssistantController = {
  toggle: () => void;
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

async function requestAssistant(messages: AssistantMessage[], signal: AbortSignal): Promise<string> {
  let response: Response;
  try {
    response = await fetch('/api/assistant/chat', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      credentials: 'same-origin',
      body: JSON.stringify({ messages }),
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new AssistantConnectionError('unavailable');
  }

  const payload: unknown = await response.json().catch(() => null);
  if (response.status === 401) throw new AssistantConnectionError('auth');
  if (response.status === 429) throw new AssistantConnectionError('limited');
  if (!response.ok || !isRecord(payload) || typeof payload.answer !== 'string' || !payload.answer.trim()) {
    throw new AssistantConnectionError('unavailable');
  }

  return payload.answer.trim();
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
  const sendButton = requireElement<HTMLButtonElement>('button[data-super-assistant-send]', 'send button');

  let open = false;
  let destroyed = false;
  let awaitingResponse = false;
  let activeRequest: AbortController | null = null;
  let currentMessage: HTMLElement | null = null;
  let currentCopy: HTMLParagraphElement | null = null;
  const conversation: AssistantMessage[] = [];

  function setStatus(copy: string, state = '') {
    status.textContent = copy;
    status.dataset.state = state;
  }

  function setComposerReady(ready: boolean) {
    form.setAttribute('aria-busy', String(!ready));
    input.disabled = !ready;
    sendButton.disabled = !ready || awaitingResponse || !input.value.trim();
  }

  function hideNotice() {
    notice.hidden = true;
    authActions.hidden = true;
    retryButton.hidden = true;
  }

  function showFailure(kind: FailureKind) {
    setComposerReady(false);
    notice.hidden = false;
    authActions.hidden = kind !== 'auth';
    retryButton.hidden = kind === 'auth';

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
    setStatus('Ready', 'ready');
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

  function finishAssistantMessage(answer: string) {
    if (currentCopy) currentCopy.textContent = answer;
    currentMessage = null;
    currentCopy = null;
    awaitingResponse = false;
    activeRequest = null;
    setComposerReady(true);
    setStatus('Ready', 'ready');
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

  async function submit() {
    const copy = input.value.trim();
    if (!copy || awaitingResponse) return;
    input.value = '';
    resizeInput();
    addMessage('user', copy);
    beginAssistantMessage();
    awaitingResponse = true;
    setComposerReady(false);
    setStatus('Thinking…');

    const pendingHistory = boundedHistory([...conversation, { role: 'user', content: copy }]);
    const controller = new AbortController();
    activeRequest = controller;
    try {
      const answer = await requestAssistant(pendingHistory, controller.signal);
      if (destroyed) return;
      conversation.splice(0, conversation.length, ...boundedHistory([
        ...pendingHistory,
        { role: 'assistant', content: answer },
      ]));
      finishAssistantMessage(answer);
    } catch (error) {
      if (destroyed || (error instanceof DOMException && error.name === 'AbortError')) return;
      discardAssistantMessage();
      showFailure(error instanceof AssistantConnectionError ? error.kind : 'unavailable');
    }
  }

  closeButton.addEventListener('click', closePanel);
  retryButton.addEventListener('click', resetFailure);
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
  document.addEventListener('keydown', onKeydown);
  window.addEventListener('pagehide', destroy);

  return { toggle, destroy };
}

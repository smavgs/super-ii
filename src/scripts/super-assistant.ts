import {
  GEMINI_LIVE_API_VERSION,
  geminiLiveSetup,
} from '@/lib/gemini-live';

type FailureKind = 'auth' | 'limited' | 'unavailable';

type TemporaryToken = {
  token: string;
};

type GroundingSource = {
  title: string;
  url: string;
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

function safeSource(value: unknown): GroundingSource | null {
  if (!isRecord(value) || !isRecord(value.web)) return null;
  const uri = value.web.uri;
  const title = value.web.title;
  if (typeof uri !== 'string') return null;
  try {
    const url = new URL(uri);
    if (url.protocol !== 'https:') return null;
    return {
      title: typeof title === 'string' && title.trim() ? title.trim().slice(0, 120) : url.hostname,
      url: url.href,
    };
  } catch {
    return null;
  }
}

async function requestTemporaryToken(): Promise<TemporaryToken> {
  let response: Response;
  try {
    response = await fetch('/api/assistant/token', {
      method: 'POST',
      headers: { accept: 'application/json' },
      credentials: 'same-origin',
    });
  } catch {
    throw new AssistantConnectionError('unavailable');
  }

  const payload: unknown = await response.json().catch(() => null);
  if (response.status === 401) throw new AssistantConnectionError('auth');
  if (response.status === 429) throw new AssistantConnectionError('limited');
  if (!response.ok
    || !isRecord(payload)
    || typeof payload.token !== 'string'
    || !/^auth_tokens\/[A-Za-z0-9_-]+$/.test(payload.token)) {
    throw new AssistantConnectionError('unavailable');
  }

  return { token: payload.token };
}

function failureFromClose(event: CloseEvent): FailureKind {
  const reason = event.reason.toLowerCase();
  return reason.includes('quota') || reason.includes('resource exhausted') || event.code === 1008
    ? 'limited'
    : 'unavailable';
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
  const retryButton = requireElement<HTMLButtonElement>('button[data-super-assistant-retry]', 'retry button');
  const form = requireElement<HTMLFormElement>('form[data-super-assistant-form]', 'form');
  const input = requireElement<HTMLTextAreaElement>('textarea[data-super-assistant-input]', 'input');
  const sendButton = requireElement<HTMLButtonElement>('button[data-super-assistant-send]', 'send button');

  let open = false;
  let socket: WebSocket | null = null;
  let connectionPromise: Promise<void> | null = null;
  let destroyed = false;
  let awaitingResponse = false;
  let currentMessage: HTMLElement | null = null;
  let currentCopy: HTMLParagraphElement | null = null;
  let currentText = '';
  const currentSources = new Map<string, GroundingSource>();

  function setStatus(copy: string, state = '') {
    status.textContent = copy;
    status.dataset.state = state;
  }

  function setComposerReady(ready: boolean) {
    form.setAttribute('aria-busy', String(!ready));
    input.disabled = !ready;
    sendButton.disabled = !ready || !input.value.trim();
  }

  function hideNotice() {
    notice.hidden = true;
    authActions.hidden = true;
    retryButton.hidden = true;
  }

  function showFailure(kind: FailureKind) {
    socket = null;
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
      noticeCopy.textContent = 'The assistant has reached its current usage limit. Please try again later.';
      return;
    }
    setStatus('Temporarily unavailable', 'attention');
    noticeCopy.textContent = 'The assistant could not connect just now.';
  }

  function scrollMessages() {
    messages.scrollTo({ top: messages.scrollHeight, behavior: 'smooth' });
  }

  function addMessage(role: 'user' | 'assistant', copy: string): HTMLParagraphElement {
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
    return paragraph;
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
    currentText = '';
    currentSources.clear();
    scrollMessages();
  }

  function appendTranscript(chunk: string) {
    if (!currentCopy || !chunk) return;
    currentText = chunk.startsWith(currentText) ? chunk : `${currentText}${chunk}`;
    currentCopy.textContent = currentText;
    scrollMessages();
  }

  function collectSources(content: Record<string, unknown>) {
    const metadata = content.groundingMetadata;
    if (!isRecord(metadata) || !Array.isArray(metadata.groundingChunks)) return;
    for (const chunk of metadata.groundingChunks) {
      const source = safeSource(chunk);
      if (source) currentSources.set(source.url, source);
    }
  }

  function finishAssistantMessage() {
    if (!currentMessage || !currentCopy) return;
    if (!currentText.trim()) currentCopy.textContent = 'I could not complete that answer. Please try again.';

    if (currentSources.size) {
      const sourceList = document.createElement('div');
      sourceList.className = 'super-assistant__sources';
      const label = document.createElement('span');
      label.textContent = 'Sources';
      sourceList.appendChild(label);
      for (const source of currentSources.values()) {
        const link = document.createElement('a');
        link.href = source.url;
        link.target = '_blank';
        link.rel = 'noreferrer noopener';
        link.textContent = source.title;
        sourceList.appendChild(link);
      }
      currentMessage.appendChild(sourceList);
    }

    currentMessage = null;
    currentCopy = null;
    currentText = '';
    currentSources.clear();
    awaitingResponse = false;
    setComposerReady(Boolean(socket));
    setStatus(socket ? 'Ready' : 'Disconnected');
    if (open && socket) input.focus();
  }

  function handleMessage(message: unknown) {
    if (!isRecord(message) || !isRecord(message.serverContent)) return;
    const content = message.serverContent;
    collectSources(content);
    const transcription = content.outputTranscription;
    const transcript = isRecord(transcription) ? transcription.text : null;
    if (typeof transcript === 'string') appendTranscript(transcript);
    if (content.interrupted === true || content.generationComplete === true || content.turnComplete === true) {
      finishAssistantMessage();
    }
  }

  function handleConnectedClose(event: CloseEvent) {
    if (!socket || destroyed) return;
    socket = null;
    if (awaitingResponse) finishAssistantMessage();
    showFailure(failureFromClose(event));
  }

  async function parseMessage(data: unknown) {
    let raw = '';
    if (typeof data === 'string') raw = data;
    else if (data instanceof Blob) raw = await data.text();
    else if (data instanceof ArrayBuffer) raw = new TextDecoder().decode(data);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  }

  async function connect() {
    if (socket || connectionPromise) return connectionPromise;
    hideNotice();
    setComposerReady(false);
    setStatus('Connecting…');

    connectionPromise = (async () => {
      const temporary = await requestTemporaryToken();
      const endpoint = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.${GEMINI_LIVE_API_VERSION}.GenerativeService.BidiGenerateContentConstrained?access_token=${temporary.token}`;
      socket = await new Promise<WebSocket>((resolve, reject) => {
        const candidate = new WebSocket(endpoint);
        let ready = false;
        const timeoutId = window.setTimeout(() => {
          candidate.close();
          reject(new AssistantConnectionError('unavailable'));
        }, 12_000);

        candidate.addEventListener('open', () => {
          setStatus('Starting…');
          candidate.send(JSON.stringify({ setup: geminiLiveSetup() }));
        });
        candidate.addEventListener('message', (event) => {
          void parseMessage(event.data).then((message) => {
            if (isRecord(message) && isRecord(message.setupComplete) && !ready) {
              ready = true;
              window.clearTimeout(timeoutId);
              resolve(candidate);
              return;
            }
            handleMessage(message);
          });
        });
        candidate.addEventListener('error', () => {
          if (!ready) {
            window.clearTimeout(timeoutId);
            reject(new AssistantConnectionError('unavailable'));
          }
        });
        candidate.addEventListener('close', (event) => {
          window.clearTimeout(timeoutId);
          if (ready) handleConnectedClose(event);
          else reject(new AssistantConnectionError(failureFromClose(event)));
        });
      });
      hideNotice();
      setComposerReady(true);
      setStatus('Ready', 'ready');
      if (open) input.focus();
    })()
      .catch((error: unknown) => {
        const kind = error instanceof AssistantConnectionError ? error.kind : 'unavailable';
        showFailure(kind);
      })
      .finally(() => {
        connectionPromise = null;
      });

    return connectionPromise;
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
    void connect();
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

  function submit() {
    const copy = input.value.trim();
    if (!copy || !socket || socket.readyState !== WebSocket.OPEN || awaitingResponse) return;
    input.value = '';
    resizeInput();
    addMessage('user', copy);
    beginAssistantMessage();
    awaitingResponse = true;
    setComposerReady(false);
    setStatus('Thinking…');
    try {
      socket.send(JSON.stringify({ realtimeInput: { text: copy } }));
    } catch {
      finishAssistantMessage();
      showFailure('unavailable');
    }
  }

  closeButton.addEventListener('click', closePanel);
  retryButton.addEventListener('click', () => void connect());
  input.addEventListener('input', resizeInput);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submit();
  });

  const onKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && open) closePanel();
  };
  const destroy = () => {
    destroyed = true;
    socket?.close();
    socket = null;
    document.removeEventListener('keydown', onKeydown);
    window.removeEventListener('pagehide', destroy);
  };
  document.addEventListener('keydown', onKeydown);
  window.addEventListener('pagehide', destroy);

  return { toggle, destroy };
}

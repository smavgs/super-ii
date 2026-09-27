export {};

type CardConfig = {
  fields: string[];
  services: string[];
  custom_links: number[];
  verified_badges: string[];
  personal_badges: string[];
  default_locale: 'en' | 'zh-CN';
  allow_share_back: boolean;
};

type CardRecord = {
  id: string;
  name: string;
  preset: string;
  status: 'draft' | 'active' | 'paused';
  config: CardConfig;
  token: string;
  path: string;
  snapshot?: Record<string, unknown> | null;
};

type Identity = { name: string; role: string; organization: string; tagline: string; bio: string };
type Vault = {
  identity_en: Identity;
  identity_zh: Identity;
  photo_url: string;
  email: string;
  phone: string;
  website: string;
  location: string;
  services: Record<string, string>;
  custom_links: Array<{ label: string; url: string }>;
};

type Connection = {
  id: string;
  card_id: string;
  card_name: string;
  name?: string;
  email?: string;
  phone?: string;
  message?: string;
  note?: string;
  context?: string;
  created_at: string;
};

type CardState = {
  cards: CardRecord[];
  connections: Connection[];
  vault: Vault;
  eligible_badges: string[];
};

const rootElement = document.querySelector<HTMLElement>('[data-card-workspace]');
if (rootElement) {
  const root = rootElement;
  const status = root.querySelector<HTMLElement>('[data-card-status]');
  const studio = root.querySelector<HTMLElement>('[data-card-studio]');
  const empty = root.querySelector<HTMLElement>('[data-card-empty]');
  const cardList = root.querySelector<HTMLElement>('[data-card-list]');
  const cardForm = root.querySelector<HTMLFormElement>('[data-card-form]');
  const vaultForm = root.querySelector<HTMLFormElement>('[data-card-vault-form]');
  const connectionList = root.querySelector<HTMLElement>('[data-connection-list]');
  const connectionEmpty = root.querySelector<HTMLElement>('[data-connection-empty]');
  const createDialog = root.querySelector<HTMLDialogElement>('[data-card-create-dialog]');
  const createForm = root.querySelector<HTMLFormElement>('[data-card-create-form]');
  const qrDialog = root.querySelector<HTMLDialogElement>('[data-owner-card-qr-dialog]');
  let state: CardState | null = null;
  let selectedId = '';
  let previewLanguage: 'en' | 'zh-CN' = 'en';
  let loaded = false;
  let loading = false;

  const serviceLabels: Record<string, string> = {
    email: 'Email', phone: 'Phone', website: 'Website', wechat: 'WeChat', whatsapp: 'WhatsApp',
    telegram: 'Telegram', linkedin: 'LinkedIn', github: 'GitHub', huggingface: 'Hugging Face',
    qq: 'QQ', red: 'RED', weibo: 'Weibo',
  };
  const verifiedLabels: Record<string, string> = {
    founding_200: 'Founding 200', community_leader: 'Community leader', publisher: 'Published builder',
    agent_builder: 'Agent builder', robot_builder: 'Robot builder', transparency_contributor: 'Transparency contributor',
    open_source_builder: 'Open-source builder',
  };
  const personalLabels: Record<string, string> = {
    ai_research: 'AI research', open_source: 'Open source', community: 'Community', robotics: 'Robotics',
    agents: 'Agents', builder: 'Builder', investor: 'Investor', founder: 'Founder',
  };
  const presetLabels: Record<string, string> = {
    superii: 'Super ii', business: 'Business', personal: 'Personal', conference: 'Conference',
    investor: 'Investor', open_source: 'Open Source', custom: 'Custom',
  };

  function setStatus(message: string, error = false) {
    if (!status) return;
    status.textContent = message;
    status.dataset.error = String(error);
  }

  async function api<T>(url: string, options?: RequestInit): Promise<T> {
    const response = await fetch(url, options);
    const payload = await response.json().catch(() => ({})) as T & { error?: string };
    if (!response.ok) throw new Error(payload.error ?? 'The request could not be completed');
    return payload;
  }

  const selectedCard = () => state?.cards.find((card) => card.id === selectedId) ?? null;

  function cloneServiceMark(service: string): DocumentFragment | null {
    const template = root.querySelector<HTMLTemplateElement>(`template[data-card-service-template="${CSS.escape(service)}"]`)
      ?? root.querySelector<HTMLTemplateElement>('template[data-card-service-template="custom"]');
    return template?.content.cloneNode(true) as DocumentFragment | null;
  }

  function createToggle(name: string, value: string, labelText: string, checked: boolean, service?: string): HTMLLabelElement {
    const label = document.createElement('label');
    label.className = `card-toggle-option${service ? ' card-toggle-option--service' : ''}`;
    const input = document.createElement('input');
    input.type = 'checkbox'; input.name = name; input.value = value; input.checked = checked;
    const body = document.createElement('span'); body.className = 'card-toggle-option__body';
    if (service) {
      const mark = cloneServiceMark(service);
      if (mark) body.appendChild(mark);
    }
    const text = document.createElement('span'); text.textContent = labelText;
    const toggle = document.createElement('span'); toggle.className = 'card-switch'; toggle.setAttribute('aria-hidden', 'true');
    body.appendChild(text); body.appendChild(toggle); label.appendChild(input); label.appendChild(body);
    return label;
  }

  function setInput(name: string, value: string) {
    const input = vaultForm?.elements.namedItem(name);
    if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) input.value = value;
  }

  function fillVaultForm() {
    if (!state || !vaultForm) return;
    const vault = state.vault;
    for (const locale of ['identity_en', 'identity_zh'] as const) {
      for (const field of ['name', 'role', 'organization', 'tagline', 'bio'] as const) setInput(`${locale}.${field}`, vault[locale][field] ?? '');
    }
    for (const field of ['photo_url', 'email', 'phone', 'website', 'location'] as const) setInput(field, vault[field] ?? '');
    for (const service of Object.keys(serviceLabels)) setInput(`services.${service}`, vault.services?.[service] ?? '');
    for (let index = 0; index < 5; index += 1) {
      setInput(`custom_links.${index}.label`, vault.custom_links?.[index]?.label ?? '');
      setInput(`custom_links.${index}.url`, vault.custom_links?.[index]?.url ?? '');
    }
  }

  function renderVerifiedOptions(card: CardRecord) {
    const target = root.querySelector<HTMLElement>('[data-verified-badge-options]');
    if (!target || !state) return;
    target.replaceChildren();
    if (!state.eligible_badges.length) {
      const note = document.createElement('span');
      note.className = 'card-inspector__hint';
      note.textContent = 'No verified badges are available yet.';
      target.appendChild(note);
      return;
    }
    for (const badge of state.eligible_badges) {
      target.appendChild(createToggle('verified_badges', badge, verifiedLabels[badge] ?? badge, card.config.verified_badges.includes(badge)));
    }
  }

  function renderCustomLinkOptions(card: CardRecord) {
    const target = root.querySelector<HTMLElement>('[data-custom-link-options]');
    if (!target || !state) return;
    target.replaceChildren();
    state.vault.custom_links.forEach((link, index) => {
      if (!link.label || !link.url) return;
      target.appendChild(createToggle('custom_links', String(index), link.label, card.config.custom_links.includes(index), 'custom'));
    });
  }

  function fillCardForm(card: CardRecord) {
    if (!cardForm) return;
    const name = cardForm.elements.namedItem('name');
    if (name instanceof HTMLInputElement) name.value = card.name;
    cardForm.querySelectorAll<HTMLInputElement>('input[name="fields"]').forEach((input) => { input.checked = card.config.fields.includes(input.value); });
    cardForm.querySelectorAll<HTMLInputElement>('input[name="services"]').forEach((input) => { input.checked = card.config.services.includes(input.value); });
    cardForm.querySelectorAll<HTMLInputElement>('input[name="personal_badges"]').forEach((input) => { input.checked = card.config.personal_badges.includes(input.value); });
    const shareBack = cardForm.elements.namedItem('allow_share_back');
    if (shareBack instanceof HTMLInputElement) shareBack.checked = card.config.allow_share_back;
    const defaultLocale = cardForm.elements.namedItem('default_locale');
    if (defaultLocale instanceof HTMLSelectElement) defaultLocale.value = card.config.default_locale;
    const title = root.querySelector<HTMLElement>('[data-card-editor-title]');
    if (title) title.textContent = card.name;
    renderVerifiedOptions(card);
    renderCustomLinkOptions(card);
    const liveActions = root.querySelector<HTMLElement>('[data-card-live-actions]');
    if (liveActions) liveActions.hidden = card.status === 'draft';
    const pause = root.querySelector<HTMLButtonElement>('[data-pause-card]');
    if (pause) pause.textContent = card.status === 'paused' ? 'Resume' : 'Pause';
  }

  function valueForService(service: string): string {
    if (!state) return '';
    if (service === 'email' || service === 'phone' || service === 'website') return state.vault[service] ?? '';
    return state.vault.services?.[service] ?? '';
  }

  function renderPreview() {
    const card = selectedCard();
    if (!card || !state) return;
    const english = state.vault.identity_en;
    const chinese = state.vault.identity_zh;
    const hasChinese = Boolean(chinese.name.trim());
    if (previewLanguage === 'zh-CN' && !hasChinese) previewLanguage = 'en';
    const identity = previewLanguage === 'zh-CN' ? chinese : english;
    const preview = root.querySelector<HTMLElement>('[data-card-preview]');
    if (preview) preview.dataset.preset = card.preset;
    const photo = root.querySelector<HTMLImageElement>('[data-preview-photo]');
    if (photo) photo.src = card.config.fields.includes('photo') && state.vault.photo_url ? state.vault.photo_url : '/brand/super-ii-icon-192.png';
    const set = (selector: string, value: string) => { const node = root.querySelector<HTMLElement>(selector); if (node) { node.textContent = value; node.hidden = !value; } };
    set('[data-preview-preset]', presetLabels[card.preset] ?? card.preset);
    set('[data-preview-name]', identity.name || 'Your name');
    set('[data-preview-role]', [card.config.fields.includes('role') ? identity.role : '', card.config.fields.includes('organization') ? identity.organization : ''].filter(Boolean).join(' · ') || 'Your role · Organization');
    set('[data-preview-location]', card.config.fields.includes('location') ? state.vault.location : '');
    set('[data-preview-tagline]', card.config.fields.includes('tagline') ? identity.tagline || 'Add a short line that helps people remember you.' : '');
    const stateNode = root.querySelector<HTMLElement>('[data-preview-state]');
    if (stateNode) { stateNode.textContent = card.status[0].toUpperCase() + card.status.slice(1); stateNode.dataset.state = card.status; }
    const badgeTarget = root.querySelector<HTMLElement>('[data-preview-badges]');
    if (badgeTarget) {
      badgeTarget.replaceChildren();
      for (const badge of card.config.verified_badges.filter((item) => state!.eligible_badges.includes(item))) {
        const element = document.createElement('span'); element.dataset.verified = 'true'; element.textContent = `✓ ${verifiedLabels[badge] ?? badge}`; badgeTarget.appendChild(element);
      }
      for (const badge of card.config.personal_badges) {
        const element = document.createElement('span'); element.textContent = personalLabels[badge] ?? badge; badgeTarget.appendChild(element);
      }
    }
    const servicesTarget = root.querySelector<HTMLElement>('[data-preview-services]');
    if (servicesTarget) {
      servicesTarget.replaceChildren();
      for (const service of card.config.services) {
        if (!valueForService(service)) continue;
        const element = document.createElement('span'); element.className = 'card-preview__service';
        const mark = cloneServiceMark(service); if (mark) element.appendChild(mark);
        const text = document.createElement('small'); text.textContent = serviceLabels[service] ?? service; element.appendChild(text);
        servicesTarget.appendChild(element);
      }
      for (const index of card.config.custom_links) {
        const link = state.vault.custom_links[index];
        if (link) {
          const element = document.createElement('span'); element.className = 'card-preview__service';
          const mark = cloneServiceMark('custom'); if (mark) element.appendChild(mark);
          const text = document.createElement('small'); text.textContent = link.label; element.appendChild(text);
          servicesTarget.appendChild(element);
        }
      }
    }
    const qr = root.querySelector<HTMLButtonElement>('[data-owner-show-qr]');
    if (qr) qr.disabled = card.status !== 'active';
    root.querySelectorAll<HTMLButtonElement>('[data-preview-language]').forEach((button) => {
      button.disabled = button.dataset.previewLanguage === 'zh-CN' && !hasChinese;
      button.setAttribute('aria-pressed', String(button.dataset.previewLanguage === previewLanguage));
    });
  }

  function renderCardList() {
    if (!state || !cardList || !studio || !empty) return;
    const hasCards = state.cards.length > 0;
    studio.hidden = !hasCards;
    empty.hidden = hasCards;
    cardList.replaceChildren();
    if (!hasCards) return;
    if (!state.cards.some((card) => card.id === selectedId)) selectedId = state.cards[0].id;
    for (const card of state.cards) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'card-list-button'; button.setAttribute('aria-current', String(card.id === selectedId));
      const strong = document.createElement('strong'); strong.textContent = card.name;
      const small = document.createElement('small'); small.textContent = `${presetLabels[card.preset] ?? card.preset} · ${card.status}`;
      button.appendChild(strong);
      button.appendChild(small);
      button.addEventListener('click', () => { selectedId = card.id; previewLanguage = card.config.default_locale; renderCardList(); });
      cardList.appendChild(button);
    }
    const card = selectedCard();
    if (card) { previewLanguage = previewLanguage || card.config.default_locale; fillCardForm(card); renderPreview(); }
  }

  function renderConnections() {
    if (!state || !connectionList || !connectionEmpty) return;
    const query = (root.querySelector<HTMLInputElement>('[data-connection-search]')?.value ?? '').trim().toLocaleLowerCase();
    const connections = state.connections.filter((connection) => [connection.name, connection.email, connection.phone, connection.context, connection.card_name].join(' ').toLocaleLowerCase().includes(query));
    connectionList.replaceChildren();
    connectionEmpty.hidden = connections.length > 0;
    const count = root.querySelector<HTMLElement>('[data-connection-count]');
    if (count) count.textContent = String(state.connections.length);
    for (const connection of connections) {
      const article = document.createElement('article'); article.className = 'connection-card';
      const summary = document.createElement('div');
      const heading = document.createElement('h4'); heading.textContent = connection.name || 'New connection';
      const details = document.createElement('p'); details.textContent = [connection.email, connection.phone, connection.card_name].filter(Boolean).join(' · ');
      summary.appendChild(heading);
      summary.appendChild(details);
      if (connection.message) { const message = document.createElement('p'); message.textContent = connection.message; summary.appendChild(message); }
      const time = document.createElement('time'); time.dateTime = connection.created_at; time.textContent = new Date(connection.created_at).toLocaleDateString(undefined, { dateStyle: 'medium' });
      const disclosure = document.createElement('details');
      const disclosureSummary = document.createElement('summary'); disclosureSummary.textContent = 'Private meeting notes';
      const notes = document.createElement('div'); notes.className = 'connection-card__notes';
      const contextLabel = document.createElement('label'); contextLabel.appendChild(document.createTextNode('Context'));
      const contextInput = document.createElement('input'); contextInput.maxLength = 160; contextInput.value = connection.context ?? ''; contextInput.placeholder = 'Where you met'; contextLabel.appendChild(contextInput);
      const noteLabel = document.createElement('label'); noteLabel.appendChild(document.createTextNode('Notes'));
      const noteInput = document.createElement('textarea'); noteInput.maxLength = 4000; noteInput.rows = 2; noteInput.value = connection.note ?? ''; noteInput.placeholder = 'Private follow-up note'; noteLabel.appendChild(noteInput);
      notes.appendChild(contextLabel);
      notes.appendChild(noteLabel);
      const actions = document.createElement('div'); actions.className = 'connection-card__actions';
      const save = document.createElement('button'); save.type = 'button'; save.className = 'text-button'; save.textContent = 'Save note';
      save.addEventListener('click', async () => {
        save.disabled = true;
        try {
          await api(`/api/cards/connections/${connection.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ context: contextInput.value, note: noteInput.value }) });
          connection.context = contextInput.value.trim(); connection.note = noteInput.value.trim(); setStatus('Private connection note saved.');
        } catch (error) { setStatus(error instanceof Error ? error.message : 'Note could not be saved', true); } finally { save.disabled = false; }
      });
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'text-button card-danger'; remove.textContent = 'Delete connection';
      remove.addEventListener('click', async () => {
        if (!confirm(`Delete ${connection.name || 'this connection'}? This cannot be undone.`)) return;
        try { await api(`/api/cards/connections/${connection.id}`, { method: 'DELETE' }); state!.connections = state!.connections.filter((item) => item.id !== connection.id); renderConnections(); setStatus('Connection deleted.'); }
        catch (error) { setStatus(error instanceof Error ? error.message : 'Connection could not be deleted', true); }
      });
      actions.appendChild(save);
      actions.appendChild(remove);
      disclosure.appendChild(disclosureSummary);
      disclosure.appendChild(notes);
      disclosure.appendChild(actions);
      article.appendChild(summary);
      article.appendChild(time);
      article.appendChild(disclosure);
      connectionList.appendChild(article);
    }
  }

  async function load(force = false) {
    if ((loaded && !force) || loading) return;
    loading = true; setStatus('Loading your private card workspace…');
    try {
      state = await api<CardState>('/api/cards');
      loaded = true; fillVaultForm(); renderCardList(); renderConnections(); setStatus(state.cards.length ? 'Your cards are ready.' : 'Create your first card when you are ready.');
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Cards could not be loaded', true); }
    finally { loading = false; }
  }

  root.querySelectorAll<HTMLButtonElement>('[data-card-tab]').forEach((button) => button.addEventListener('click', () => {
    const tab = button.dataset.cardTab;
    root.querySelectorAll<HTMLButtonElement>('[data-card-tab]').forEach((candidate) => candidate.setAttribute('aria-selected', String(candidate === button)));
    root.querySelectorAll<HTMLElement>('[data-card-tab-panel]').forEach((panel) => { panel.hidden = panel.dataset.cardTabPanel !== tab; });
    if (tab === 'connections') renderConnections();
  }));

  root.querySelectorAll<HTMLElement>('[data-card-accordion]').forEach((accordion) => {
    accordion.querySelectorAll<HTMLDetailsElement>(':scope > .card-inspector__sections > details, :scope > .card-vault__sections > details').forEach((details) => {
      details.addEventListener('toggle', () => {
        if (!details.open) return;
        accordion.querySelectorAll<HTMLDetailsElement>(':scope > .card-inspector__sections > details, :scope > .card-vault__sections > details').forEach((candidate) => {
          if (candidate !== details) candidate.open = false;
        });
      });
    });
  });

  root.querySelectorAll<HTMLButtonElement>('[data-new-card]').forEach((button) => button.addEventListener('click', () => createDialog?.showModal()));
  root.querySelector('[data-close-card-create]')?.addEventListener('click', () => createDialog?.close());
  createDialog?.addEventListener('click', (event) => { if (event.target === createDialog) createDialog.close(); });
  createForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = createForm.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (submit) submit.disabled = true;
    try {
      const values = new FormData(createForm);
      const result = await api<{ card: CardRecord }>('/api/cards', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: values.get('name'), preset: values.get('preset') }) });
      selectedId = result.card.id; createDialog?.close(); await load(true); setStatus('Card created. Add details, then publish when it is ready.');
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Card could not be created', true); }
    finally { if (submit) submit.disabled = false; }
  });

  vaultForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const values = new FormData(vaultForm);
    const identity = (prefix: string): Identity => ({
      name: String(values.get(`${prefix}.name`) ?? ''), role: String(values.get(`${prefix}.role`) ?? ''),
      organization: String(values.get(`${prefix}.organization`) ?? ''), tagline: String(values.get(`${prefix}.tagline`) ?? ''),
      bio: String(values.get(`${prefix}.bio`) ?? ''),
    });
    const services: Record<string, string> = {};
    for (const service of Object.keys(serviceLabels)) {
      if (['email', 'phone', 'website'].includes(service)) continue;
      services[service] = String(values.get(`services.${service}`) ?? '');
    }
    const customLinks: Array<{ label: string; url: string }> = [];
    for (let index = 0; index < 5; index += 1) {
      const label = String(values.get(`custom_links.${index}.label`) ?? '').trim();
      const url = String(values.get(`custom_links.${index}.url`) ?? '').trim();
      if (label || url) customLinks.push({ label, url });
    }
    const payload: Vault = {
      identity_en: identity('identity_en'), identity_zh: identity('identity_zh'),
      photo_url: String(values.get('photo_url') ?? ''), email: String(values.get('email') ?? ''),
      phone: String(values.get('phone') ?? ''), website: String(values.get('website') ?? ''),
      location: String(values.get('location') ?? ''), services, custom_links: customLinks,
    };
    const submit = vaultForm.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (submit) submit.disabled = true;
    try {
      const result = await api<{ vault: Vault }>('/api/cards/vault', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      if (state) state.vault = result.vault;
      renderCardList(); setStatus('Private details saved. Publish a card when you want its public snapshot updated.');
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Private details could not be saved', true); }
    finally { if (submit) submit.disabled = false; }
  });

  cardForm?.addEventListener('change', () => {
    const card = selectedCard();
    if (!card || !cardForm) return;
    const checked = (name: string) => Array.from(cardForm.querySelectorAll<HTMLInputElement>(`input[name="${name}"]:checked`)).map((input) => input.value);
    card.config = {
      fields: checked('fields'), services: checked('services'), custom_links: checked('custom_links').map(Number),
      verified_badges: checked('verified_badges'), personal_badges: checked('personal_badges'),
      default_locale: (cardForm.elements.namedItem('default_locale') as unknown as HTMLSelectElement).value === 'zh-CN' ? 'zh-CN' : 'en',
      allow_share_back: (cardForm.elements.namedItem('allow_share_back') as HTMLInputElement).checked,
    };
    const name = cardForm.elements.namedItem('name'); if (name instanceof HTMLInputElement) card.name = name.value;
    renderPreview();
  });
  cardForm?.addEventListener('input', () => { const card = selectedCard(); const name = cardForm.elements.namedItem('name'); if (card && name instanceof HTMLInputElement) { card.name = name.value; renderPreview(); } });
  cardForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const card = selectedCard();
    if (!card) return;
    const submitter = event.submitter as HTMLButtonElement | null;
    const action = submitter?.value === 'publish' ? 'publish' : 'save';
    if (submitter) submitter.disabled = true;
    try {
      await api(`/api/cards/${card.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, name: card.name, config: card.config }) });
      await load(true); setStatus(action === 'publish' ? 'Card published. Its unlisted link and QR are live.' : 'Draft saved.');
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Card could not be saved', true); }
    finally { if (submitter) submitter.disabled = false; }
  });

  root.querySelectorAll<HTMLButtonElement>('[data-preview-language]').forEach((button) => button.addEventListener('click', () => { previewLanguage = button.dataset.previewLanguage === 'zh-CN' ? 'zh-CN' : 'en'; renderPreview(); }));
  root.querySelector('[data-owner-show-qr]')?.addEventListener('click', () => {
    const card = selectedCard(); if (!card || card.status !== 'active') return;
    const image = root.querySelector<HTMLImageElement>('[data-owner-card-qr-image]'); if (image) image.src = `${card.path}/qr.svg`;
    const name = root.querySelector<HTMLElement>('[data-owner-card-qr-name]'); if (name) name.textContent = card.name;
    qrDialog?.showModal();
  });
  root.querySelector('[data-close-owner-card-qr]')?.addEventListener('click', () => qrDialog?.close());
  qrDialog?.addEventListener('click', (event) => { if (event.target === qrDialog) qrDialog.close(); });

  root.querySelector('[data-copy-card-link]')?.addEventListener('click', async () => {
    const card = selectedCard(); if (!card) return;
    try { await navigator.clipboard.writeText(new URL(card.path, location.origin).toString()); setStatus('Unlisted card link copied.'); }
    catch { setStatus('The unlisted link could not be copied.', true); }
  });
  root.querySelector('[data-native-share-card]')?.addEventListener('click', async () => {
    const card = selectedCard(); if (!card) return;
    const url = new URL(card.path, location.origin).toString();
    try { if (navigator.share) await navigator.share({ title: card.name, text: 'My Super ii Card', url }); else { await navigator.clipboard.writeText(url); setStatus('Unlisted card link copied.'); } }
    catch (error) { if (!(error instanceof DOMException && error.name === 'AbortError')) setStatus('The card could not be shared.', true); }
  });
  root.querySelector('[data-pause-card]')?.addEventListener('click', async () => {
    const card = selectedCard(); if (!card) return;
    const action = card.status === 'paused' ? 'resume' : 'pause';
    try { await api(`/api/cards/${card.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action }) }); await load(true); setStatus(action === 'pause' ? 'Card paused. Its link no longer opens.' : 'Card is live again.'); }
    catch (error) { setStatus(error instanceof Error ? error.message : 'Card state could not be changed', true); }
  });
  root.querySelector('[data-rotate-card]')?.addEventListener('click', async () => {
    const card = selectedCard(); if (!card || !confirm('Rotate this unlisted link? The old link and QR will stop working immediately.')) return;
    try { await api(`/api/cards/${card.id}/rotate`, { method: 'POST' }); await load(true); setStatus('Unlisted link rotated. Share the new link or QR.'); }
    catch (error) { setStatus(error instanceof Error ? error.message : 'Link could not be rotated', true); }
  });
  root.querySelector('[data-delete-card]')?.addEventListener('click', async () => {
    const card = selectedCard(); if (!card || !confirm(`Delete “${card.name}”? Its link, QR and card connections will be permanently removed.`)) return;
    try { await api(`/api/cards/${card.id}`, { method: 'DELETE' }); selectedId = ''; await load(true); setStatus('Card deleted.'); }
    catch (error) { setStatus(error instanceof Error ? error.message : 'Card could not be deleted', true); }
  });
  root.querySelector<HTMLInputElement>('[data-connection-search]')?.addEventListener('input', renderConnections);

  window.addEventListener('workspace:section', (event) => { if ((event as CustomEvent<string>).detail === 'cards') void load(); });
  if (location.hash === '#cards' || location.hash.startsWith('#cards/')) void load();
}

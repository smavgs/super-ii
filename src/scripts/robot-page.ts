type RobotPlan = {
  title: string;
  summary: string;
  catalog_revision: string;
  input: Record<string, unknown>;
  components: Array<{ slug: string; name: string; manufacturer: string; ownership: string; evidenceStatus: string }>;
  robot_check: Array<{ dimension: string; status: string; explanation: string }>;
  open_requirements: string[];
  safety_approval: false;
  safety: string;
};

const root = document.querySelector<HTMLElement>('[data-robot-page]');
const planner = document.querySelector<HTMLFormElement>('[data-robot-planner]');
const result = document.querySelector<HTMLElement>('[data-robot-result]');
const saveForm = document.querySelector<HTMLFormElement>('[data-robot-save]');
let currentPlan: RobotPlan | null = null;

function syncOwnerPrefix() {
  const owner = saveForm?.elements.namedItem('organization_id');
  const handle = owner instanceof HTMLSelectElement ? owner.selectedOptions[0]?.dataset.handle ?? 'you' : 'you';
  text('[data-robot-owner-prefix]', `superii.site/robot/${handle}/`);
}

function text(target: string, value: string) {
  const element = document.querySelector<HTMLElement>(target);
  if (element) element.textContent = value;
}

function node(tag: string, className?: string, value?: string) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (value) element.textContent = value;
  return element;
}

function renderPlan(plan: RobotPlan) {
  text('[data-plan-title]', plan.title);
  text('[data-plan-summary]', plan.summary);
  text('[data-plan-revision]', plan.catalog_revision);
  const components = document.querySelector('[data-plan-components]');
  const checks = document.querySelector('[data-plan-check]');
  const unknowns = document.querySelector('[data-plan-unknowns]');
  components?.replaceChildren(...plan.components.map((component, index) => {
    const row = node('a', 'robot-bom__row') as HTMLAnchorElement;
    row.href = `/robot/components/${encodeURIComponent(component.slug)}`;
    row.appendChild(node('span', '', String(index + 1).padStart(2, '0')));
    const description = node('span');
    description.appendChild(node('strong', '', component.name));
    description.appendChild(node('small', '', `${component.manufacturer} · ${component.ownership}`));
    row.appendChild(description);
    row.appendChild(node('em', `robot-evidence robot-evidence--${component.evidenceStatus}`, component.evidenceStatus));
    return row;
  }));
  checks?.replaceChildren(...plan.robot_check.map((check) => {
    const row = node('div', 'robot-check__row');
    const heading = node('div');
    heading.appendChild(node('strong', '', check.dimension));
    heading.appendChild(node('span', `robot-evidence robot-evidence--${check.status}`, check.status));
    row.appendChild(heading);
    row.appendChild(node('p', '', check.explanation));
    return row;
  }));
  unknowns?.replaceChildren(...plan.open_requirements.map((item) => node('li', '', item)));
  text('[data-plan-safety]', plan.safety);
  const title = saveForm?.elements.namedItem('title') as HTMLInputElement | null;
  const slug = saveForm?.elements.namedItem('slug') as HTMLInputElement | null;
  const summary = saveForm?.elements.namedItem('summary') as HTMLTextAreaElement | null;
  if (title) title.value = plan.title;
  if (slug) slug.value = plan.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
  if (summary) summary.value = plan.summary;
  if (result) {
    result.hidden = false;
    result.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

planner?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const status = document.querySelector<HTMLElement>('[data-robot-plan-status]');
  const data = new FormData(planner);
  const input = {
    goal: data.get('goal'), experience: data.get('experience'), compute: data.get('compute'),
    environment: data.get('environment'), budget: data.get('budget'), owned_components: [],
  };
  if (status) status.textContent = 'Checking the evidence graph…';
  try {
    const response = await fetch('/api/robot/plan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
    const payload = await response.json() as { plan?: RobotPlan; error?: string };
    if (!response.ok || !payload.plan) throw new Error(payload.error ?? 'Plan unavailable');
    currentPlan = payload.plan;
    renderPlan(currentPlan);
    if (status) status.textContent = 'Plan generated from the current source-backed catalogue.';
  } catch (error) {
    if (status) status.textContent = error instanceof Error ? error.message : 'Plan unavailable. Please try again.';
  }
});

saveForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const status = document.querySelector<HTMLElement>('[data-robot-save-status]');
  if (!currentPlan) { if (status) status.textContent = 'Make a plan first.'; return; }
  if (root?.dataset.signedIn !== 'true') {
    const destination = `${location.pathname}${location.search}#make`;
    location.href = `/sign-up?redirect_url=${encodeURIComponent(destination)}`;
    return;
  }
  const data = new FormData(saveForm);
  const body = {
    title: data.get('title'), slug: data.get('slug'), summary: data.get('summary'), audience: data.get('audience'),
    visibility: data.get('visibility'), organization_id: data.get('organization_id') || null, change_summary: 'First Robot plan', planner_input: currentPlan.input,
  };
  if (status) status.textContent = 'Saving an immutable version…';
  try {
    const response = await fetch('/api/robot/robots', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const payload = await response.json() as { href?: string; error?: string };
    if (!response.ok || !payload.href) throw new Error(payload.error ?? 'Robot could not be saved.');
    location.href = payload.href;
  } catch (error) {
    if (status) status.textContent = error instanceof Error ? error.message : 'Robot could not be saved.';
  }
});

const ownerSelector = saveForm?.elements.namedItem('organization_id');
if (ownerSelector instanceof HTMLSelectElement) ownerSelector.addEventListener('change', syncOwnerPrefix);
syncOwnerPrefix();

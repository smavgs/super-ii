import {
  kindNames,
  roomDocument,
  roomActions,
  workroomHandoff,
  type Workroom,
  type WorkContext,
} from "../lib/workrooms";
import { workKindIcons } from "../lib/workspace-presentation";

const stateNames: Record<string, string> = {
  active: "In progress",
  blocked: "Blocked",
  review: "Ready to review",
  complete: "Complete",
  archived: "Archived",
};
const node = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text = "",
  className = "",
) => {
  const el = document.createElement(tag);
  el.textContent = text;
  if (className) el.className = className;
  return el;
};
function authored<T extends HTMLElement>(element: T): T {
  element.dataset.noTranslate = "";
  return element;
}
function add(parent: HTMLElement, ...children: (Node | string)[]) {
  for (const child of children)
    parent.appendChild(
      typeof child === "string" ? document.createTextNode(child) : child,
    );
}
async function api<T>(path: string, value?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: value === undefined ? "GET" : "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: value === undefined ? {} : { "content-type": "application/json" },
    body: value === undefined ? undefined : JSON.stringify(value),
    signal: AbortSignal.timeout(30000),
  });
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("The service did not return a result. Please retry.");
  }
  if (!response.ok)
    throw Object.assign(
      new Error(
        (data as { error?: string }).error || "Your work could not be saved.",
      ),
      { status: response.status },
    );
  return data as T;
}

const hub = document.querySelector<HTMLElement>("[data-workroom-hub]");
if (hub && !hub.dataset.ready) {
  hub.dataset.ready = "true";
  const list = hub.querySelector<HTMLElement>("[data-room-list]")!,
    status = hub.querySelector<HTMLElement>("[data-room-list-status]")!;
  const search = hub.querySelector<HTMLInputElement>("[data-room-search]")!,
    filter = hub.querySelector(
      "[data-room-filter]",
    ) as unknown as HTMLSelectElement;
  const more = hub.querySelector<HTMLButtonElement>("[data-room-more]")!;
  let items: Workroom[] = [],
    limit = 2;
  function draw() {
    const matches = items.filter(
      (r) =>
        (filter.value === "all" ||
          (filter.value === "current"
            ? !["complete", "archived"].includes(r.status)
            : r.status === filter.value)) &&
        `${r.document.title} ${r.document.goal} ${kindNames[r.document.kind]}`
          .toLocaleLowerCase()
          .includes(search.value.toLocaleLowerCase()),
    );
    list.replaceChildren();
    for (const room of matches.slice(0, limit)) {
      const a = node("a", "", "workroom-row");
      a.href = `/workspace/workrooms/${room.id}`;
      const text = node("span");
      add(
        text,
        authored(node("strong", room.document.title)),
        (() => {
          const summary = node("small");
          add(
            summary,
            node("span", kindNames[room.document.kind]),
            " · ",
            authored(
              node(
                "span",
                room.status === "complete"
                  ? room.document.goal
                  : room.document.next_action || room.document.goal,
              ),
            ),
          );
          return summary;
        })(),
      );
      const icon = node("i", "", `ph ${workKindIcons[room.document.kind]} workspace-kind-icon`);
      icon.setAttribute("aria-hidden", "true");
      const badge = node("span", stateNames[room.status], "workspace-state");
      badge.dataset.state = room.status;
      a.dataset.kind = room.document.kind;
      add(a, icon, text, badge);
      add(list, a);
    }
    status.textContent = matches.length
      ? `${Math.min(limit, matches.length)} of ${matches.length} workrooms`
      : items.length
        ? "No workrooms match this view."
        : "Start a workroom to save a goal and continue where you left off.";
    more.hidden = matches.length <= limit;
  }
  search.addEventListener("input", () => {
    limit = 2;
    draw();
  });
  filter.addEventListener("change", () => {
    limit = 2;
    draw();
  });
  more.addEventListener("click", () => {
    const previous = limit;
    limit += 4;
    draw();
    list.querySelectorAll("a")[previous]?.focus();
  });
  api<WorkContext>("/api/workrooms")
    .then((data: WorkContext) => {
      items = data.rooms;
      hub.querySelector<HTMLElement>("[data-room-filters]")!.hidden = items.length === 0;
      draw();
    })
    .catch((error) => {
      status.textContent = error.message;
      const retry = node("button", "Retry", "text-button");
      retry.type = "button";
      retry.addEventListener("click", () => location.reload());
      add(list, retry);
    });
}

const root = document.querySelector<HTMLElement>("[data-workroom-editor]");
if (root && !root.dataset.ready) {
  root.dataset.ready = "true";
  const get = <T = HTMLElement>(selector: string) =>
    root.querySelector(selector) as unknown as T;
  const form = get<HTMLFormElement>("[data-room-form]"),
    entryForm = get<HTMLFormElement>("[data-entry-form]"),
    shareForm = get<HTMLFormElement>("[data-share-form]");
  const status = get("[data-room-status]"),
    retry = get<HTMLButtonElement>("[data-room-retry]");
  const field = (name: string) =>
    form.elements.namedItem(name) as
      | HTMLInputElement
      | HTMLTextAreaElement
      | HTMLSelectElement
      | RadioNodeList
      | null;
  const id = root.dataset.roomId || "";
  let room: Workroom | null = null,
    formVersion = 0,
    formDirty = false,
    entryDirty = false,
    limit = 6;
  const creationKey = crypto.randomUUID();
  let entryKey = crypto.randomUUID();
  function tell(text: string) {
    status.textContent = text;
  }
  function error(e: unknown) {
    tell(e instanceof Error ? e.message : "Your work could not be saved.");
    if ((e as { status?: number })?.status === 401) {
      const a = node("a", "Sign in");
      a.href = `/sign-in?redirect_url=${encodeURIComponent(location.pathname)}`;
      add(status, " ", a);
    }
  }
  function reviewField() {
    const complete = field("status")?.value === "complete";
    get("[data-review-field]")?.toggleAttribute("hidden", !complete);
    get("[data-review-copy]")?.toggleAttribute("hidden", !complete);
  }
  function history() {
    if (!room) return;
    const box = get("[data-room-history]");
    box.replaceChildren();
    const items = [...room.entries].reverse();
    for (const entry of items.slice(0, limit)) {
      const item = node("article");
      const label =
        entry.document.kind === "result"
          ? "Reported result"
          : entry.document.kind === "blocker"
            ? "Blocker"
            : "Note";
      add(
        item,
        node("strong", label),
        authored(
          node("span", ` · ${entry.actor}${entry.agent ? " (agent)" : ""}`),
        ),
        authored(node("p", entry.document.body)),
      );
      if (entry.document.url) {
        const a = node("a", "Open supplied evidence");
        a.href = entry.document.url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        add(item, a);
      }
      if (entry.document.sha256)
        add(
          item,
          node(
            "p",
            `Reported SHA-256: ${entry.document.sha256}`,
            "workroom-muted",
          ),
        );
      const date = node(
        "time",
        new Date(entry.created_at).toLocaleString(
          document.documentElement.lang || "en",
        ),
      );
      date.dateTime = entry.created_at;
      add(item, node("br"), date);
      add(box, item);
    }
    if (!items.length)
      add(
        box,
        node(
          "p",
          "No entries yet. Save a decision, a result or what is blocking progress.",
        ),
      );
    get("[data-entry-count]").textContent = `(${items.length})`;
    get<HTMLButtonElement>("[data-history-more]").hidden =
      items.length <= limit;
  }
  function render(next: Workroom) {
    room = next;
    get("[data-room-title]").textContent = room.document.title;
    get("[data-room-subtitle]").replaceChildren(
      node("span", kindNames[room.document.kind]),
      document.createTextNode(" · "),
      node(
        "span",
        room.organization_id ? "Team workroom" : "Personal workroom",
      ),
    );
    get("[data-room-state]").textContent = stateNames[room.status];
    get("[data-room-state]").dataset.state = room.status;
    get("[data-room-goal]").textContent = room.document.goal;
    get("[data-room-next-label]").textContent =
      room.status === "complete" ? "Reviewed result" : "Next action";
    get("[data-room-next]").textContent =
      room.status === "complete"
        ? room.entries
            .find((entry) => entry.id === next.reviewed_entry_id)
            ?.document.body.slice(0, 300) || "Member-reviewed result"
        : room.document.next_action ||
          "Choose the next action and save it in Goal and source.";
    const actions = get("[data-room-actions]");
    actions.replaceChildren();
    for (const action of roomActions(room)) {
      const wrapper = node("div"),
        a = node("a", action.label, "workspace-tool-link");
      a.href = action.href;
      if (action.href.startsWith("https:")) {
        a.target = "_blank";
        a.rel = "noopener noreferrer";
      }
      add(wrapper, a, node("p", action.detail));
      add(actions, wrapper);
    }
    if (!formDirty) {
      for (const [key, value] of Object.entries(room.document)) {
        const el = field(key);
        if (el) el.value = value;
      }
      field("status")!.value = room.status;
      formVersion = room.version;
      const reviewed = field("reviewed_entry_id") as HTMLSelectElement;
      reviewed.replaceChildren(new Option("Select a saved result", ""));
      for (const entry of room.entries.filter(
        (e) => e.document.kind === "result",
      ))
        reviewed.add(
          new Option(
            `${entry.document.body.slice(0, 90)} · ${entry.actor}`,
            entry.id,
          ),
        );
      reviewed.value = room.reviewed_entry_id || "";
      reviewField();
    }
    get<HTMLFieldSetElement>("[data-room-fields]").disabled = !room.can_edit;
    get<HTMLFieldSetElement>("[data-entry-fields]").disabled =
      !room.can_edit || room.status === "archived";
    for (const selector of [
      "[data-room-overview]",
      "[data-room-results]",
      "[data-room-people]",
    ])
      get(selector).hidden = false;
    get("[data-room-access]").textContent = room.organization_id
      ? "Members of this organization can view this room. Owners, admins and maintainers can edit. Team membership controls access."
      : "Only the owner and members explicitly added below can open this workroom.";
    shareForm.hidden = !room.can_share;
    const members = get("[data-room-members]");
    members.replaceChildren();
    for (const member of room.collaborators) {
      const row = node("div", "", "workroom-member");
      add(row, node("span", `${member.handle} · ${member.role}`));
      if (room.can_share) {
        const button = node("button", "Remove access", "text-button");
        button.type = "button";
        button.addEventListener("click", () =>
          changeAccess(member.handle, "remove", button),
        );
        add(row, button);
      }
      add(members, row);
    }
    get("[data-room-agent-access]").textContent =
      room.organization_id && room.repository_id
        ? "A repository-scoped agent connection can read this room or report progress when you explicitly grant workroom:read or workroom:report. Agent results wait for member review."
        : "A handoff grants no account access. Direct agent reports currently require a team workroom bound to a repository; personal work can use the handoff and save reviewed results here.";
    get("[data-room-pin]").textContent = room.revision_id
      ? `Source captured at revision ${room.revision_id}${room.source_commit ? ` · ${room.source_commit}` : ""}. Opening the editor shows current work; this saved reference does not advance automatically.`
      : "External versions are supplied references. No source files have been imported or executed by this workroom.";
    history();
  }
  async function load() {
    retry.hidden = true;
    tell("Loading your Workspace…");
    try {
      if (id) {
        render(await api<Workroom>(`/api/workrooms/${id}`));
        get<HTMLDetailsElement>("[data-room-edit-details]").open = false;
        get<HTMLDetailsElement>("[data-room-results]").open = true;
      } else {
        const context: WorkContext = await api<WorkContext>("/api/workrooms");
        const org = field("organization_id") as HTMLSelectElement,
          repo = field("repository_id") as HTMLSelectElement;
        org.replaceChildren(new Option("Just me", ""));
        for (const item of context.organizations)
          org.add(new Option(item.name, item.id));
        function sources() {
          const selected = repo.value;
          repo.replaceChildren(new Option("Start without a repository", ""));
          for (const item of context.repositories.filter(
            (r) => !org.value || r.organization_id === org.value,
          ))
            repo.add(
              new Option(
                `${item.title || item.slug} · ${item.owner}/${item.slug}`,
                item.id,
              ),
            );
          repo.value = Array.from(repo.options).some(
            (o) => o.value === selected,
          )
            ? selected
            : "";
        }
        org.addEventListener("change", sources);
        sources();
        repo.addEventListener("change", () => {
          const selected = context.repositories.find(
            (r) => r.id === repo.value,
          );
          if (selected) {
            field("title")!.value ||= selected.title || selected.slug;
            field("kind")!.value =
              selected.kind === "space" ? "app" : selected.kind;
          }
        });
        const query = new URLSearchParams(location.search),
          source = query.get("source") || "";
        if (source.length <= 2048) {
          field("source_url")!.value = source;
          if (source) get<HTMLDetailsElement>(".workroom-source").open = true;
        }
        const requested = context.repositories.find(
          (r) => r.id === query.get("repository"),
        );
        if (requested) {
          get<HTMLDetailsElement>("[data-room-source-options]").open = true;
          repo.value = requested.id;
          repo.dispatchEvent(new Event("change"));
        }
      }
      get("[data-room-body]").hidden = false;
      tell("");
    } catch (e) {
      error(e);
      retry.hidden = false;
    }
  }
  retry.addEventListener("click", load);
  // Reveal an invalid optional field before native validation tries to focus it.
  form.addEventListener("invalid", (event) => {
    let parent = (event.target as HTMLElement).parentElement;
    while (parent && parent !== root) {
      if (parent instanceof HTMLDetailsElement) parent.open = true;
      parent = parent.parentElement;
    }
  }, true);
  form.addEventListener("input", () => {
    formDirty = true;
    reviewField();
  });
  entryForm.addEventListener("input", () => {
    entryDirty = true;
  });
  window.addEventListener("beforeunload", (event) => {
    if (formDirty || entryDirty) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector<HTMLButtonElement>(
      "button[type=submit]",
    )!;
    button.disabled = true;
    tell("Saving…");
    try {
      const raw = Object.fromEntries(
        [
          "title",
          "kind",
          "goal",
          "acceptance",
          "next_action",
          "source_url",
          "source_revision",
        ].map((k) => [k, field(k)?.value || ""]),
      );
      const parsed = roomDocument.safeParse(raw);
      if (!parsed.success) throw new Error(parsed.error.issues[0].message);
      if (!id) {
        const result = await api<{ id: string }>("/api/workrooms", {
          creation_key: creationKey,
          organization_id: field("organization_id")!.value || null,
          repository_id: field("repository_id")!.value || null,
          document: parsed.data,
        });
        formDirty = false;
        location.assign(`/workspace/workrooms/${result.id}`);
      } else {
        const result = await api<Workroom>(`/api/workrooms/${id}?action=save`, {
          version: formVersion,
          document: parsed.data,
          status: field("status")!.value,
          reviewed_entry_id: field("reviewed_entry_id")!.value || null,
        });
        formDirty = false;
        render(result);
        tell(
          result.status === "complete"
            ? "Saved as complete with your reviewed result."
            : "Workroom saved.",
        );
      }
    } catch (e) {
      error(e);
    } finally {
      button.disabled = false;
    }
  });
  entryForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = entryForm.querySelector<HTMLButtonElement>(
      "button[type=submit]",
    )!;
    button.disabled = true;
    tell("Saving entry…");
    try {
      const data = new FormData(entryForm);
      const result = await api<Workroom>(`/api/workrooms/${id}?action=entry`, {
        creation_key: entryKey,
        document: Object.fromEntries(
          ["kind", "body", "url", "sha256"].map((k) => [
            k,
            String(data.get(k) || ""),
          ]),
        ),
      });
      entryKey = crypto.randomUUID();
      entryForm.reset();
      entryDirty = false;
      render(result);
      tell(
        formDirty
          ? "Entry saved. Your unsaved goal changes are still in the form; reload before saving them."
          : "Entry saved. Results remain reported until you review them.",
      );
    } catch (e) {
      error(e);
    } finally {
      button.disabled = false;
    }
  });
  async function changeAccess(
    handle: string,
    role: string,
    button: HTMLButtonElement,
  ) {
    button.disabled = true;
    tell("Updating access…");
    try {
      render(
        await api<Workroom>(`/api/workrooms/${id}?action=share`, {
          handle,
          role,
        }),
      );
      tell("Access updated.");
    } catch (e) {
      error(e);
    } finally {
      button.disabled = false;
    }
  }
  shareForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(shareForm);
    void changeAccess(
      String(data.get("handle")),
      String(data.get("role")),
      shareForm.querySelector("button")!,
    );
  });
  get("[data-history-more]").addEventListener("click", () => {
    limit += 6;
    history();
  });
  get("[data-room-export]").addEventListener("click", () => {
    if (!room) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(workroomHandoff(room), null, 2) + "\n"], {
        type: "application/json",
      }),
    );
    const a = node("a");
    a.href = url;
    a.download = `superii-workroom-${id}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    tell(
      "Downloaded the saved workroom. Unsaved form changes are not included.",
    );
  });
  void load();
}

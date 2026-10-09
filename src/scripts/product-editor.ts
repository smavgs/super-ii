import {
  companyDocumentSchema,
  productDocumentSchema,
  emptyCompany,
  emptyProduct,
  publicHttpsUrl,
  productPath,
  publicationNeeds,
  type ProductDraft,
  type ProductImage,
} from "@/lib/products";
import { translateProduct as tr } from "@/lib/product-localization";
import type { companyWorkspace } from "@/lib/product-store";
const root = document.querySelector<HTMLElement>("[data-product-editor]");
if (root) initialize(root);
function initialize(root: HTMLElement) {
  const t = (value: string) => tr(value, document.documentElement.lang);
  const localPath = (path: string) => {
    const language = document.documentElement.lang;
    return (
      (language === "zh-CN" ? "/zh-cn" : language === "ru" ? "/ru" : "") + path
    );
  };
  const $ = <T = HTMLElement>(selector: string) =>
    root.querySelector(selector) as T;
  $("[data-preview-toggle]").addEventListener("click", (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    const open = button.getAttribute("aria-expanded") !== "true";
    button.setAttribute("aria-expanded", String(open));
    root.dataset.previewOpen = String(open);
  });
  const form = $<HTMLFormElement>("[data-product-form]");
  const status = $("[data-editor-status]");
  const initial = JSON.parse(root.dataset.initial ?? "{}") as {
    draft: ProductDraft | null;
    workspace: Awaited<ReturnType<typeof companyWorkspace>>;
  };
  let draft = initial.draft;
  let companyVersion = draft?.company_version ?? 0;
  let org = draft?.organization_id ?? "";
  let busy = false;
  let dirty = false;
  let invalidField:
    HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null = null;
  let media: ProductImage[] = [];
  let selected = draft?.product.image_ids ?? [];
  let creationKey = crypto.randomUUID();
  let localImage = "";
  let lastUploadFile: File | null = null;
  const signedIn = root.dataset.signedIn === "true";
  const storageKey = "superii-company-product-unsaved";
  const field = (name: string) =>
    form.elements.namedItem(name) as
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
  function setValues(prefix: string, value: Record<string, unknown>) {
    for (const [key, text] of Object.entries(value)) {
      const input = field(`${prefix}.${key}`);
      if (input && typeof text === "string") input.value = text;
    }
  }
  function rows(kind: "spec" | "resource") {
    return Array.from(
      $(`[data-${kind === "spec" ? "specs" : "resources"}]`).querySelectorAll(
        "fieldset",
      ),
    ).map((row) =>
      Object.fromEntries(
        Array.from(row.querySelectorAll<HTMLInputElement>("[data-field]")).map(
          (input) => [input.dataset.field!, input.value.trim()],
        ),
      ),
    );
  }
  function documents() {
    const company: Record<string, unknown> = { ...emptyCompany() };
    const product: Record<string, unknown> = { ...emptyProduct() };
    for (const [name, value] of new FormData(form)) {
      const [kind, key] = name.split(".");
      if (kind === "company") company[key] = String(value).trim();
      else if (kind === "product") product[key] = String(value).trim();
    }
    product.specs = rows("spec");
    product.resources = rows("resource");
    product.image_ids = [...selected];
    return { company, product };
  }
  function validated() {
    const value = documents();
    const company = companyDocumentSchema.safeParse(value.company);
    const product = productDocumentSchema.safeParse(value.product);
    if (!company.success || !product.success) {
      const failure = !company.success
        ? company.error
        : !product.success
          ? product.error
          : null;
      const prefix = !company.success ? "company" : "product";
      const path = failure?.issues[0]?.path ?? [];
      const input =
        path[0] === "specs" || path[0] === "resources"
          ? $(`[data-${path[0]}]`)
              ?.querySelectorAll("fieldset")
              [Number(path[1])]?.querySelector<HTMLInputElement>(
                `[data-field="${String(path[2])}"]`,
              )
          : field(`${prefix}.${String(path[0])}`);
      input?.closest("details")?.setAttribute("open", "");
      invalidField = input ?? null;
      throw new Error(failure?.issues[0]?.message ?? t("Review your details."));
    }
    return { company: company.data, product: product.data };
  }
  function message(text: string, error = false) {
    status.textContent = t(text);
    status.dataset.error = String(error);
  }
  function preview() {
    const { company, product } = documents();
    const text = (selector: string, value: unknown, fallback = "") => {
      $(selector).textContent = String(value || fallback);
    };
    const zh = document.documentElement.lang === "zh-CN";
    text(
      "[data-preview-company]",
      zh ? company.name_zh || company.name : company.name || company.name_zh,
      t("Your company"),
    );
    text(
      "[data-preview-title]",
      zh ? product.name_zh || product.name : product.name || product.name_zh,
      t("Your product"),
    );
    text(
      "[data-preview-summary]",
      zh
        ? product.summary_zh || product.summary
        : product.summary || product.summary_zh,
      t("Explain what the product does."),
    );
    text(
      "[data-preview-description]",
      zh
        ? product.description_zh || product.description
        : product.description || product.description_zh,
    );
    text(
      "[data-preview-kind]",
      `${t(String(product.kind))} · ${t(String(product.stage))}`,
    );
    text(
      "[data-preview-contact]",
      [
        company.email,
        company.phone,
        company.wechat,
        company.representative_card_url,
      ]
        .filter(Boolean)
        .join("\n"),
      t("Add a public contact method."),
    );
    const logo = $<HTMLImageElement>("[data-preview-logo]");
    logo.hidden = true;
    try {
      if (company.logo_url) {
        const url = publicHttpsUrl(String(company.logo_url));
        logo.src =
          media.find((item) => url.endsWith(`/showcase-images/${item.id}.jpg`))
            ?.image_url ?? url;
        logo.hidden = false;
      }
    } catch {}
    const image = $<HTMLImageElement>("[data-preview-image]");
    const first = media.find((item) => item.id === selected[0]);
    image.hidden = !first;
    if (first) {
      image.src = first.image_url;
      image.alt = first.alt_text;
    }
    const specs = $("[data-preview-specs]");
    specs.replaceChildren();
    for (const row of rows("spec")) {
      const p = document.createElement("p");
      p.textContent = `${row.label}: ${row.value}`;
      specs.appendChild(p);
    }
    const links = $("[data-preview-resources]");
    links.replaceChildren();
    for (const row of rows("resource")) {
      const p = document.createElement("p");
      p.textContent = `${row.label} — ${row.url}`;
      links.appendChild(p);
    }
  }
  function addRow(
    kind: "spec" | "resource",
    value: Record<string, unknown> = {},
  ) {
    const holder = $(`[data-${kind === "spec" ? "specs" : "resources"}]`);
    if (holder.children.length >= (kind === "spec" ? 20 : 12)) return;
    const fragment = $<HTMLTemplateElement>(
      `[data-${kind}-template]`,
    ).content.cloneNode(true) as DocumentFragment;
    const row = fragment.querySelector("fieldset")!;
    for (const input of row.querySelectorAll<HTMLInputElement>("[data-field]"))
      if (typeof value[input.dataset.field!] === "string")
        input.value = String(value[input.dataset.field!]);
    row.querySelector("[data-remove-row]")?.addEventListener("click", () => {
      row.remove();
      changed();
    });
    holder.appendChild(fragment);
  }
  function changed() {
    dirty = true;
    $("[data-draft-state]").textContent = t("Unsaved changes");
    preview();
  }
  function friendlySlug(value: string) {
    return value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, "-")
      .replace(/^-|-$/gu, "")
      .slice(0, 70)
      .replace(/-$/u, "");
  }
  for (const [name, target] of [
    ["company.name", "handle"],
    ["company.name_zh", "handle"],
    ["product.name", "slug"],
    ["product.name_zh", "slug"],
  ])
    field(name)?.addEventListener("input", () => {
      const input = field(target);
      const prefix = target === "handle" ? "company" : "product";
      const nameValue =
        field(`${prefix}.name`)?.value ||
        field(`${prefix}.name_zh`)?.value ||
        "";
      if (input && !input.dataset.manual)
        input.value = nameValue
          ? (friendlySlug(nameValue) || `${prefix}-${creationKey.slice(0, 8)}`)
              .slice(0, target === "handle" ? 40 : 80)
              .replace(/-$/u, "")
          : "";
    });
  for (const name of ["handle", "slug"])
    field(name)?.addEventListener("input", () => {
      field(name)!.dataset.manual = "true";
    });
  for (const spec of draft?.product.specs ?? []) addRow("spec", spec);
  for (const resource of draft?.product.resources ?? [])
    addRow("resource", resource);
  if (!draft) {
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? "null");
      if (saved && !saved.draftId) {
        setValues("company", saved.company);
        setValues("product", saved.product);
        creationKey = saved.creationKey || creationKey;
        if (field("handle")) field("handle")!.value = saved.handle ?? "";
        if (field("slug")) field("slug")!.value = saved.slug ?? "";
        for (const spec of saved.product?.specs ?? []) addRow("spec", spec);
        for (const resource of saved.product?.resources ?? [])
          addRow("resource", resource);
        message(
          "Your preview was restored in this tab. Save it to keep it in your account.",
        );
        dirty = true;
      }
    } catch {
      /* Storage may be unavailable. Explicit sign-in fallback below. */
    }
  }
  function preserveForSignIn() {
    const value = documents();
    try {
      sessionStorage.setItem(
        storageKey,
        JSON.stringify({
          ...value,
          creationKey,
          handle: field("handle")?.value,
          slug: field("slug")?.value,
        }),
      );
    } catch {
      throw new Error(
        t(
          "This browser cannot keep the preview during sign-in. Keep this tab open and sign in in another tab.",
        ),
      );
    }
    location.assign(
      `/sign-in?redirect_url=${encodeURIComponent(localPath("/workspace/products/new"))}`,
    );
  }
  async function api<T>(path: string, body?: unknown): Promise<T> {
    const response = await fetch(
      path,
      body === undefined
        ? { cache: "no-store" }
        : {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          },
    );
    const value = (await response.json()) as T & { error?: string };
    if (!response.ok) throw new Error(value.error || t("Please try again."));
    return value;
  }
  async function save(): Promise<ProductDraft | null> {
    const value = validated();
    if (!signedIn) {
      preserveForSignIn();
      return null;
    }
    const created = !draft;
    if (created) {
      const handle =
        (org
          ? initial.workspace.companies.find((item) => item.id === org)?.handle
          : field("handle")?.value) ?? "";
      draft = await api<ProductDraft>("/api/products", {
        ...value,
        creation_key: creationKey,
        organization_id: org || null,
        handle,
        slug: field("slug")?.value ?? "",
        company_version: companyVersion,
      });
    } else
      draft = await api<ProductDraft>(`/api/products/${draft!.id}`, {
        ...value,
        action: "save",
        version: draft!.version,
        company_version: companyVersion,
      });
    if (!draft)
      throw new Error(t("Your work could not be saved. Please try again."));
    companyVersion = draft.company_version;
    org = draft.organization_id;
    dirty = false;
    try {
      sessionStorage.removeItem(storageKey);
    } catch {
      /* Server draft is saved. */
    }
    if (created) {
      history.replaceState(
        null,
        "",
        localPath(`/workspace/products/${draft.id}`),
      );
      field("handle")?.setAttribute("disabled", "");
      field("slug")?.setAttribute("disabled", "");
      $<HTMLSelectElement>("[data-company-owner]").disabled = true;
      await loadMedia();
    }
    updateSavedState();
    message("Draft saved. You can return from Workspace on any device.");
    return draft;
  }
  function updateSavedState() {
    $("[data-draft-state]").textContent = t(
      draft?.status === "published"
        ? "Draft saved · published page stays live"
        : "Draft saved · private",
    );
    $<HTMLButtonElement>("[data-pause]").hidden = draft?.status !== "published";
  }
  async function run(work: () => Promise<void>) {
    if (busy) return;
    busy = true;
    invalidField = null;
    // Inert prevents edits during an atomic save/publish without excluding values from FormData.
    form.inert = true;
    form.setAttribute("aria-busy", "true");
    try {
      await work();
    } catch (error) {
      message(
        error instanceof Error ? error.message : "Please try again.",
        true,
      );
    } finally {
      busy = false;
      form.inert = false;
      form.removeAttribute("aria-busy");
      (
        invalidField as
          HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null
      )?.focus();
    }
  }
  form.addEventListener("input", changed);
  form.addEventListener("change", changed);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void run(async () => {
      message("Saving…");
      await save();
    });
  });
  $("[data-add-spec]").addEventListener("click", () => {
    addRow("spec");
    changed();
  });
  $("[data-add-resource]").addEventListener("click", () => {
    addRow("resource");
    changed();
  });
  $<HTMLSelectElement>("[data-company-owner]")?.addEventListener(
    "change",
    (event) => {
      org = (event.target as HTMLSelectElement).value;
      const company = initial.workspace.companies.find(
        (item) => item.id === org,
      );
      companyVersion = company?.version ?? 0;
      setValues("company", company?.company ?? emptyCompany());
      $("[data-company-handle-label]").hidden = Boolean(org);
      selected = [];
      media = [];
      renderMedia();
      void loadMedia().catch(() =>
        message("Company images could not be loaded.", true),
      );
      changed();
    },
  );
  let suggestions: {
    source_url: string;
    company_name: string;
    product_name: string;
    summary: string;
    notice: string;
  } | null = null;
  $("[data-source-read]").addEventListener(
    "click",
    () =>
      void run(async () => {
        message("Reading website suggestions…");
        suggestions = await api<NonNullable<typeof suggestions>>(
          "/api/products/source",
          { url: $<HTMLInputElement>("[data-source-url]").value },
        );
        if (!suggestions) return;
        $("[data-source-result]").hidden = false;
        $("[data-source-notice]").textContent = t(suggestions.notice);
        const link = $<HTMLAnchorElement>("[data-source-link]");
        link.href = suggestions.source_url;
        link.textContent = suggestions.source_url;
        $("[data-source-summary]").textContent = [
          suggestions.company_name,
          suggestions.product_name,
          suggestions.summary,
        ]
          .filter(Boolean)
          .join("\n");
        message("Review the suggestions before using them.");
      }),
  );
  $("[data-source-apply]").addEventListener("click", () => {
    if (!suggestions) return;
    for (const [name, value] of Object.entries({
      "company.name": suggestions.company_name,
      "product.name": suggestions.product_name,
      "product.summary": suggestions.summary,
      "product.source_url": suggestions.source_url,
    }))
      if (field(name) && !field(name)!.value) field(name)!.value = value;
    if (field("handle") && !field("handle")!.value)
      field("handle")!.value = friendlySlug(field("company.name")!.value).slice(
        0,
        40,
      );
    if (field("slug") && !field("slug")!.value)
      field("slug")!.value = friendlySlug(field("product.name")!.value);
    changed();
  });
  function renderMedia() {
    const holder = $("[data-product-media]");
    holder.replaceChildren();
    for (const item of media) {
      const label = document.createElement("label");
      label.className = "product-media-choice";
      const check = document.createElement("input");
      check.type = "checkbox";
      check.checked = selected.includes(item.id);
      check.setAttribute("aria-label", item.alt_text);
      const img = document.createElement("img");
      img.src = item.image_url;
      img.alt = item.alt_text;
      img.width = 160;
      img.height = 100;
      label.appendChild(check);
      label.appendChild(img);
      const wrapper = document.createElement("div");
      wrapper.className = "product-media-option";
      const logo = document.createElement("button");
      logo.type = "button";
      logo.className = "text-button";
      logo.textContent = t("Use as company logo");
      logo.addEventListener("click", () => {
        field("company.logo_url")!.value =
          `https://superii.site/showcase-images/${item.id}.jpg`;
        changed();
      });
      wrapper.appendChild(label);
      wrapper.appendChild(logo);
      holder.appendChild(wrapper);
      check.addEventListener("change", () => {
        if (check.checked) {
          if (selected.length >= 3) {
            check.checked = false;
            message("Choose up to three images.", true);
            return;
          }
          selected.push(item.id);
        } else selected = selected.filter((id) => id !== item.id);
        changed();
      });
    }
    preview();
  }
  async function loadMedia() {
    if (!org || !signedIn) return;
    const requestedOrg = org;
    const data = await api<{ items: ProductImage[]; remaining: number }>(
      `/api/products/media?organization_id=${requestedOrg}`,
    );
    if (org !== requestedOrg) return;
    media = data.items;
    $("[data-image-quota]").textContent =
      `${t("Uploads remaining")}: ${data.remaining}. ${t("Three successful Showcase uploads per member account, for its lifetime. Removing an image does not restore an upload.")}`;
    renderMedia();
  }
  $<HTMLInputElement>("[data-image-file]").addEventListener(
    "change",
    async () => {
      if (localImage) URL.revokeObjectURL(localImage);
      const input = $<HTMLInputElement>("[data-image-file]");
      const file = input.files?.[0];
      const image = $<HTMLImageElement>("[data-image-preview]");
      image.hidden = true;
      if (!file) return;
      try {
        // Preview the same rasterized JPEG used by upload, never arbitrary selected file bytes.
        const photo = await prepareImage(file);
        if (input.files?.[0] !== file) return;
        localImage = URL.createObjectURL(photo);
        image.src = localImage;
        image.hidden = false;
      } catch (error) {
        if (input.files?.[0] === file)
          message(
            error instanceof Error ? error.message : "Please try again.",
            true,
          );
      }
    },
  );
  $("[data-image-upload]").addEventListener(
    "click",
    () =>
      void run(async () => {
        const file = $<HTMLInputElement>("[data-image-file]").files?.[0];
        const alt = $<HTMLInputElement>("[data-image-alt]").value.trim();
        if (!file || !alt)
          throw new Error(t("Choose an image and describe it first."));
        if (file === lastUploadFile)
          throw new Error(
            t(
              "This image was already uploaded. Choose it from the company images.",
            ),
          );
        const photo = await prepareImage(file);
        if (!(await save())) return;
        message("Uploading image…");
        const params = new URLSearchParams({
          organization_id: org,
          alt_text: alt,
        });
        const response = await fetch(`/api/showcase/media?${params}`, {
          method: "POST",
          headers: { "content-type": "image/jpeg" },
          body: photo,
        });
        const data = (await response.json()) as {
          error?: string;
          item: { id: string };
        };
        if (!response.ok) throw new Error(data.error || t("Please try again."));
        lastUploadFile = file;
        if (selected.length < 3) selected.push(data.item.id);
        await loadMedia();
        dirty = true;
        await save();
        $<HTMLInputElement>("[data-image-file]").value = "";
        $("[data-image-preview]").hidden = true;
        message("Image uploaded and draft saved.");
      }),
  );
  $<HTMLSelectElement>("[data-card-choice]").addEventListener(
    "change",
    (event) => {
      field("company.representative_card_url")!.value = (
        event.target as HTMLSelectElement
      ).value;
      changed();
    },
  );
  if (signedIn)
    void api<{ items: Array<{ name: string; url: string }> }>(
      "/api/products/cards",
    )
      .then((data) => {
        for (const item of data.items) {
          const option = document.createElement("option");
          option.value = item.url;
          option.textContent = item.name;
          $("[data-card-choice]").appendChild(option);
        }
      })
      .catch(() => {
        /* Manual Card entry remains available. */
      });
  for (const action of ["start", "check"])
    $(`[data-website-${action}]`).addEventListener(
      "click",
      () =>
        void run(async () => {
          if (!(await save())) return;
          const data = await api<{
            record_name: string;
            record_value: string;
            checked_at: string | null;
          }>("/api/products/website", {
            organization_id: org,
            website: field("company.website")!.value,
            action,
          });
          $("[data-website-record]").hidden = false;
          $("[data-website-record]").textContent =
            `TXT ${data.record_name}\n${data.record_value}`;
          $("[data-website-check]").hidden = false;
          $("[data-website-status]").textContent = t(
            data.checked_at
              ? "Website control checked."
              : "Add this exact TXT record with your DNS provider, then check it here.",
          );
        }),
    );
  function showShare() {
    if (!draft) return;
    const path = productPath(draft.owner, draft.slug);
    $("[data-share-result]").hidden = false;
    $<HTMLAnchorElement>("[data-public-link]").href = localPath(path);
    $<HTMLAnchorElement>("[data-sheet-link]").href = localPath(`${path}/sheet`);
    $<HTMLAnchorElement>("[data-qr-link]").href = `${path}/qr.svg`;
    $<HTMLImageElement>("[data-share-qr]").src = `${path}/qr.svg`;
  }
  $("[data-publish]").addEventListener(
    "click",
    () =>
      void run(async () => {
        if (!$<HTMLInputElement>("[data-authorized]").checked)
          throw new Error(
            t(
              "Confirm that you are authorized and have reviewed the public details.",
            ),
          );
        const value = validated();
        const needs = publicationNeeds(value.company, value.product);
        if (needs.length) throw new Error(needs.map(t).join(" "));
        if (!(await save())) return;
        draft = await api<ProductDraft>(`/api/products/${draft!.id}`, {
          action: "publish",
          version: draft!.version,
          company_version: companyVersion,
          authorized: true,
        });
        companyVersion = draft!.company_version;
        updateSavedState();
        showShare();
        message("Published. Your company and product are ready to share.");
        $("[data-share-result]").scrollIntoView({ block: "nearest" });
      }),
  );
  $("[data-pause]").addEventListener(
    "click",
    () =>
      void run(async () => {
        if (!draft) return;
        if (dirty) await save();
        draft = await api<ProductDraft>(`/api/products/${draft!.id}`, {
          action: "pause",
          version: draft!.version,
        });
        $("[data-share-result]").hidden = true;
        updateSavedState();
        message(
          "Product page paused. Its public links are unavailable until you publish again.",
        );
      }),
  );
  $("[data-copy-link]").addEventListener(
    "click",
    () =>
      void run(async () => {
        if (!draft) return;
        await navigator.clipboard.writeText(
          `https://superii.site${productPath(draft.owner, draft.slug)}`,
        );
        message("Link copied.");
      }),
  );
  window.addEventListener("beforeunload", (event) => {
    if (dirty && !busy) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  void loadMedia().catch(() =>
    message("Company images could not be loaded.", true),
  );
  preview();
  if (draft) {
    updateSavedState();
    if (draft.status === "published") showShare();
  }
}
async function prepareImage(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/") || file.size > 16 * 1024 * 1024)
    throw new Error("Choose an image smaller than 16 MB.");
  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width < 384 || bitmap.height < 240)
      throw new Error("Choose an image at least 384 by 240 pixels.");
    for (let attempt = 0; attempt < 8; attempt++) {
      const canvas = document.createElement("canvas");
      canvas.width = attempt < 5 ? 1600 : 1000;
      canvas.height = (canvas.width * 5) / 8;
      const context = canvas.getContext("2d", { alpha: false });
      if (!context)
        throw new Error("This browser could not prepare the image.");
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      const scale = Math.min(
        canvas.width / bitmap.width,
        canvas.height / bitmap.height,
      );
      const w = bitmap.width * scale,
        h = bitmap.height * scale;
      context.drawImage(
        bitmap,
        (canvas.width - w) / 2,
        (canvas.height - h) / 2,
        w,
        h,
      );
      const photo = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(
          resolve,
          "image/jpeg",
          Math.max(0.5, 0.88 - attempt * 0.06),
        ),
      );
      if (photo && photo.size <= 600000) return photo;
    }
    throw new Error("Choose a smaller or simpler image.");
  } finally {
    bitmap.close();
  }
}

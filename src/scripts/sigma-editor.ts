import { sigmaCopy } from "@/lib/sigma-copy";
import {
  sigmaDocumentSchema,
  sigmaLocales,
  sigmaSlug,
  type SigmaDocument,
  type SigmaLocale,
} from "@/lib/sigma-input";
const desk = document.querySelector<HTMLElement>("[data-sigma-desk]");
const locale = (desk?.dataset.locale ?? "en") as SigmaLocale;
const c = sigmaCopy(locale);
const prefix = locale === "en" ? "" : locale === "ru" ? "/ru" : "/zh-cn";
async function api(path: string, body: unknown) {
  const response = await fetch(`/api/sigma/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = (await response.json()) as {
    error?: string;
    message?: string;
    id: string;
    href?: string;
    version: number;
    deleted?: boolean;
    processed: number;
    edition: Record<string, number>;
  };
  if (!response.ok)
    throw new Error(
      result.error === "conflict"
        ? c.conflict
        : result.error === "unavailable"
          ? c.unavailable
          : (result.message ?? c.saveError),
    );
  return result;
}
const form = document.querySelector<HTMLFormElement>("[data-sigma-editor]");
let dirty = false;
let busy = false;
function documentFromForm(): SigmaDocument {
  const values = new FormData(form!);
  const translations: SigmaDocument["translations"] = {};
  sigmaLocales.forEach((lang) => {
    const title = String(values.get(`${lang}.title`) ?? "").trim(),
      body = String(values.get(`${lang}.body`) ?? "").trim(),
      summary = String(values.get(`${lang}.summary`) ?? "").trim();
    if (title || body || summary) translations[lang] = { title, summary, body };
  });
  const sources = String(values.get("sources") ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const split = line.indexOf("|");
      const url = (split < 0 ? line : line.slice(split + 1)).trim();
      return {
        label: split < 0 ? new URL(url).hostname : line.slice(0, split).trim(),
        url,
      };
    });
  const images: SigmaDocument["images"] = [];
  for (let i = 0; i < 2; i++) {
    const url = String(values.get(`image.${i}.url`) ?? "");
    if (url)
      images.push({
        url,
        alt: String(values.get(`image.${i}.alt`)),
        credit: String(values.get(`image.${i}.credit`)),
        source_url: String(values.get(`image.${i}.source_url`)),
      });
  }
  return sigmaDocumentSchema.parse({
    source_language: values.get("source_language"),
    category: values.get("category"),
    translations,
    sources,
    images,
    rights_confirmed: values.get("rights_confirmed") === "on",
  });
}
form?.addEventListener("input", () => {
  dirty = true;
  const preview = form.querySelector("[data-draft-preview]")!;
  const values = new FormData(form);
  const language = String(values.get("source_language"));
  ["title", "summary", "body"].forEach((field, i) => {
    preview.children[i].textContent = String(
      values.get(`${language}.${field}`) ?? "",
    );
  });
});
window.addEventListener("beforeunload", (event) => {
  if (dirty || busy) {
    event.preventDefault();
    event.returnValue = "";
  }
});
async function save(action: string) {
  if (!form || busy) return;
  const status = form.querySelector<HTMLElement>("[data-editor-status]")!;
  const buttons = [...form.querySelectorAll<HTMLButtonElement>("button")];
  try {
    const document = documentFromForm();
    busy = true;
    buttons.forEach((button) => (button.disabled = true));
    const id = form.dataset.id!;
    const slug =
      form.dataset.slug ||
      sigmaSlug(document.translations[document.source_language]!.title, id);
    const result = await api("stories", {
      id,
      slug,
      version: Number(form.dataset.version),
      action,
      document,
    });
    if (result.deleted) {
      dirty = false;
      busy = false;
      location.assign(`${prefix}/sigma/editor`);
      return;
    }
    form.dataset.version = String(result.version);
    form.dataset.slug = slug;
    form
      .querySelectorAll<HTMLInputElement>("[data-image-upload]")
      .forEach((input) => (input.disabled = false));
    history.replaceState(null, "", `${prefix}/sigma/editor?id=${id}`);
    dirty = false;
    status.textContent =
      action === "publish"
        ? c.published
        : action === "submit"
          ? c.submitted
          : c.saved;
    if (action === "publish" && result.href?.startsWith("/sigma/")) {
      const link = window.document.createElement("a");
      link.href = prefix + result.href;
      link.textContent = c.read;
      status.appendChild(window.document.createTextNode(" "));
      status.appendChild(link);
    }
    window.document.dispatchEvent(new Event("sigma:thanks"));
  } catch (error) {
    status.textContent =
      error instanceof Error && !error.message.startsWith("[")
        ? error.message
        : c.saveError;
  } finally {
    busy = false;
    buttons.forEach((button) => (button.disabled = false));
  }
}
form?.addEventListener("submit", (event) => {
  event.preventDefault();
  const action =
    ((event as SubmitEvent).submitter as HTMLButtonElement)?.value ?? "save";
  void save(action);
});
async function jpeg(file: File | Blob) {
  if (file.size > 15_000_000) throw new Error(c.saveError);
  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width * bitmap.height > 48_000_000) throw new Error(c.saveError);
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d")!;
    for (const dimension of [1800, 1200, 900]) {
      const scale = Math.min(
        1,
        dimension / Math.max(bitmap.width, bitmap.height),
      );
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.85, 0.65, 0.5]) {
        const output = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, "image/jpeg", quality),
        );
        if (output && output.size < 600_000) return output;
      }
    }
    throw new Error(c.saveError);
  } finally {
    bitmap.close();
  }
}
async function upload(id: string, file: File | Blob) {
  const response = await fetch(`/api/sigma/media/${id}`, {
    method: "POST",
    headers: { "content-type": "image/jpeg" },
    body: await jpeg(file),
  });
  const result = (await response.json()) as { url?: unknown };
  const image =
    typeof result.url === "string"
      ? result.url.match(
          /^\/api\/sigma\/media\/([a-f0-9-]{36})\/([a-f0-9]{64})\.jpg$/,
        )
      : null;
  if (!response.ok || !image || image[1] !== id) throw new Error(c.saveError);
  return `/api/sigma/media/${image[1]}/${image[2]}.jpg`;
}
form?.querySelectorAll<HTMLElement>("[data-image-index]").forEach((section) => {
  const input = section.querySelector<HTMLInputElement>("[data-image-upload]")!;
  const hidden = section.querySelector<HTMLInputElement>(
    'input[type="hidden"]',
  )!;
  const preview = section.querySelector<HTMLImageElement>("img")!;
  input.addEventListener("change", async () => {
    if (!input.files?.[0] || busy) return;
    busy = true;
    input.disabled = true;
    try {
      const imageUrl = await upload(form.dataset.id!, input.files[0]);
      hidden.value = imageUrl;
      preview.src = imageUrl;
      preview.hidden = false;
      dirty = true;
    } catch (error) {
      form.querySelector("[data-editor-status]")!.textContent =
        error instanceof Error ? error.message : c.saveError;
    } finally {
      busy = false;
      input.disabled = false;
      input.value = "";
    }
  });
  section
    .querySelector("[data-image-remove]")
    ?.addEventListener("click", () => {
      hidden.value = "";
      preview.hidden = true;
      preview.removeAttribute("src");
      dirty = true;
    });
});
const importer = document.querySelector<HTMLInputElement>(
  "[data-import-draft]",
);
document
  .querySelector("[data-import-trigger]")
  ?.addEventListener("click", () => importer?.click());
importer?.addEventListener("change", async () => {
  const file = importer.files?.[0];
  if (!file) return;
  const status = document.querySelector("[data-import-status]")!;
  importer.disabled = true;
  busy = true;
  try {
    if (file.size > 8_000_000) throw new Error(c.saveError);
    const bundle = JSON.parse(await file.text());
    const id = crypto.randomUUID();
    // Imported prose is always private and needs a fresh rights/source check.
    const document = sigmaDocumentSchema.parse({
      ...bundle.document,
      images: [],
      rights_confirmed: false,
    });
    const slug = sigmaSlug(
      document.translations[document.source_language]!.title,
      id,
    );
    const result = await api("stories", {
      id,
      version: 0,
      slug,
      action: "save",
      document,
    });
    const images = Array.isArray(bundle.images)
      ? bundle.images.slice(0, 2)
      : [];
    for (const image of images) {
      if (
        typeof image.data !== "string" ||
        !/^data:image\/(jpeg|png|webp);base64,/.test(image.data)
      )
        throw new Error(c.saveError);
      const binary = atob(image.data.split(",")[1]);
      if (binary.length > 3_000_000) throw new Error(c.saveError);
      const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
      const url = await upload(
        id,
        new Blob([bytes], {
          type: image.data.slice(5, image.data.indexOf(";")),
        }),
      );
      document.images.push({
        url,
        alt: String(image.alt ?? ""),
        credit: String(image.credit ?? ""),
        source_url: String(image.source_url ?? ""),
      });
    }
    if (document.images.length)
      await api("stories", {
        id,
        version: result.version,
        slug,
        action: "save",
        document: sigmaDocumentSchema.parse(document),
      });
    busy = false;
    location.assign(`${prefix}/sigma/editor?id=${id}`);
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : c.saveError;
  } finally {
    busy = false;
    importer.disabled = false;
    importer.value = "";
  }
});
document
  .querySelector<HTMLFormElement>("[data-editor-access]")
  ?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const target = event.currentTarget as HTMLFormElement;
    const status = target.querySelector("[data-access-status]")!;
    try {
      await api("editors", {
        handle: new FormData(target).get("handle"),
        enabled:
          ((event as SubmitEvent).submitter as HTMLButtonElement).value ===
          "true",
      });
      status.textContent = c.editorSaved;
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : c.saveError;
    }
  });
document
  .querySelector<HTMLFormElement>("[data-sigma-edition]")
  ?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const target = event.currentTarget as HTMLFormElement;
    const status = target.querySelector("[data-edition-status]")!;
    const button = target.querySelector<HTMLButtonElement>("button")!;
    button.disabled = true;
    try {
      const result = await api("editions", {
        action: "prepare",
        id: crypto.randomUUID(),
        stories: new FormData(target).getAll("story"),
      });
      location.assign(
        `${prefix}/sigma/editor?tab=editions&edition=${result.id}`,
      );
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : c.saveError;
    } finally {
      button.disabled = false;
    }
  });
document
  .querySelector("[data-preview-language]")
  ?.addEventListener("change", (event) => {
    const lang = (event.currentTarget as unknown as { value: string }).value;
    document
      .querySelectorAll<HTMLElement>("[data-edition-preview]")
      .forEach(
        (frame) => (frame.hidden = frame.dataset.editionPreview !== lang),
      );
  });
document
  .querySelector<HTMLButtonElement>("[data-send-edition]")
  ?.addEventListener("click", async (event) => {
    if (!window.confirm(c.sendConfirm)) return;
    const button = event.currentTarget as HTMLButtonElement;
    const section = button.closest<HTMLElement>("[data-current-edition]")!;
    const id = section.dataset.currentEdition!;
    const status = section.querySelector("[data-delivery-status]")!;
    button.disabled = true;
    busy = true;
    status.textContent = c.sending;
    try {
      for (let batch = 0; batch < 300; batch++) {
        const result = await api("editions", {
          action: "send",
          id,
          confirmation: id,
        });
        const edition = result.edition;
        ["sent", "remaining", "failed"].forEach((key) => {
          section.querySelector(`[data-delivery-${key}]`)!.textContent = String(
            edition[key] ?? 0,
          );
        });
        if (!edition.remaining) {
          status.textContent = c.deliveryDone;
          break;
        }
        if (!result.processed || batch === 299) {
          status.textContent = c.retryLater;
          break;
        }
      }
    } catch (error) {
      status.textContent =
        error instanceof Error ? error.message : c.unavailable;
    } finally {
      busy = false;
      button.disabled = false;
    }
  });

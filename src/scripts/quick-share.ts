import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { createUploader, type UploadContext } from "@/lib/creator-upload";
import { uploadPath, CARD_MAX_BYTES } from "@/lib/creator-card";
import {
  canonicalDriveLink,
  cardSuggestions,
  detectShareFormat,
  formatLabels,
  quickCard,
  quickSlug,
  quickTitle,
  shareSize,
  shareFormats,
  validPackagePath,
  type ShareKind,
} from "@/lib/quick-share";
import { shareText } from "@/lib/quick-share-localization";

type Saved = {
  key: string;
  slug: string;
  title: string;
  kind: ShareKind;
  format: string;
  license: string;
  basis: string;
  source_url: string;
  context: UploadContext;
  publicHref?: string;
  selection?: Array<{ path: string; size: number }>;
};
type Status = {
  repository_id: string;
  branch_id: string;
  revision_id: string;
  status: string;
  version: number;
  public_href: string;
  files: Array<{ path: string; sha256: string; size_bytes: string }>;
};

export function initializeQuickShare() {
  document
    .querySelectorAll<HTMLElement>("[data-quick-share]")
    .forEach((root) => {
      if (root.dataset.initialized || !root.dataset.profileKey) return;
      root.dataset.initialized = "true";
      const dialog = root.querySelector<HTMLDialogElement>("dialog")!;
      const form = root.querySelector<HTMLFormElement>("form")!;
      const open = root.querySelector<HTMLAnchorElement>("[data-quick-open]")!;
      const fields = form.querySelector<HTMLFieldSetElement>("fieldset")!;
      const submit = form.querySelector<HTMLButtonElement>(
        "[data-quick-submit]",
      )!;
      const progressBox = form.querySelector<HTMLElement>(
        "[data-quick-progress]",
      )!;
      const progress = form.querySelector<HTMLProgressElement>("progress")!;
      const fileStatus = form.querySelector<HTMLElement>(
        "[data-quick-file-status]",
      )!;
      const stage = form.querySelector<HTMLElement>("[data-quick-stage]")!;
      const status = form.querySelector<HTMLElement>("[data-quick-status]")!;
      const editor = form.querySelector<HTMLAnchorElement>(
        "[data-quick-editor]",
      )!;
      const reset =
        form.querySelector<HTMLButtonElement>("[data-quick-reset]")!;
      const resultBox = form.querySelector<HTMLElement>("[data-quick-result]")!;
      const t = (text: string, values: Record<string, string | number> = {}) =>
        shareText(text, root.dataset.locale, values);
      const local = (path: string) =>
        root.dataset.locale === "ru"
          ? `/ru${path}`
          : root.dataset.locale === "zh-CN"
            ? `/zh-cn${path}`
            : path;
      const field = (name: string) =>
        form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement;
      const kind = (): ShareKind =>
        form.querySelector<HTMLInputElement>("[name=kind]:checked")?.value ===
        "dataset"
          ? "dataset"
          : "model";
      const drive = () =>
        form.querySelector<HTMLInputElement>("[name=source]:checked")?.value ===
        "drive";
      const storeKey = `superii-quick-share-v1:${root.dataset.profileKey}`;
      let saved: Saved | null = null;
      let queue: Array<{ file: File; path: string }> = [];
      let card = "",
        summary = "",
        library = "",
        task = "",
        publicHref = "",
        selecting = false,
        busy = false,
        done = false,
        retry = false;
      const note = (text: string, error = false) => {
        status.textContent = text;
        status.dataset.error = String(error);
      };
      function persist() {
        try {
          if (saved) sessionStorage.setItem(storeKey, JSON.stringify(saved));
          else sessionStorage.removeItem(storeKey);
        } catch {
          /* In-memory retries still work when storage is unavailable. */
        }
      }
      function formats(selected?: string) {
        const select = field("format") as HTMLSelectElement;
        select.replaceChildren(
          ...shareFormats[kind()].map(
            (value) => new Option(t(formatLabels[value]), value),
          ),
        );
        select.value =
          selected && shareFormats[kind()].includes(selected as never)
            ? selected
            : "other";
      }
      function syncSource() {
        const isDrive = drive();
        form.querySelector<HTMLElement>("[data-drive-fields]")!.hidden =
          !isDrive;
        form.querySelector<HTMLElement>("[data-computer-fields]")!.hidden =
          isDrive;
        for (const name of ["drive_url", "drive_confirmed"]) {
          field(name).disabled = !isDrive;
          (field(name) as HTMLInputElement).required = isDrive;
        }
        form.querySelector<HTMLElement>("[data-quick-public]")!.hidden =
          isDrive;
        submit.querySelector("span")!.textContent = t(
          retry ? "Retry" : isDrive ? "Share link" : "Upload & publish",
        );
        const sourceNeeded =
          field("basis").value !== "" && field("basis").value !== "original";
        form.querySelector<HTMLElement>("[data-quick-origin]")!.hidden =
          !sourceNeeded;
        field("source_url").disabled = !sourceNeeded;
        (field("source_url") as HTMLInputElement).required = sourceNeeded;
        if (saved)
          form
            .querySelectorAll<HTMLInputElement>("[name=kind],[name=source]")
            .forEach((input) => (input.disabled = true));
      }
      function finish(href: string) {
        if (!href.startsWith("/") || href.startsWith("//"))
          throw new Error("Invalid result link");
        publicHref = href;
        done = true;
        saved = null;
        persist();
        stage.textContent = t("Ready to share");
        note(t("Ready to share"));
        progressBox.hidden = true;
        fields.hidden = true;
        submit.hidden = true;
        resultBox.hidden = false;
        reset.hidden = false;
        const link = form.querySelector<HTMLAnchorElement>(
          "[data-quick-result-link]",
        )!;
        link.href = local(href);
        link.focus();
      }
      async function json<T = Record<string, unknown>>(
        url: string,
        body?: unknown,
      ) {
        const response = await fetch(
          url,
          body === undefined
            ? { cache: "no-store" }
            : {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(body),
              },
        );
        const result = (await response.json()) as Record<string, unknown>;
        if (!response.ok)
          throw new Error(
            typeof result.error === "string"
              ? result.error
              : t("Could not save. Please retry."),
          );
        return result as T;
      }
      const api = (suffix: string) =>
        `/api/repositories/${saved!.context.repositoryId}/${suffix}?branch=${encodeURIComponent(saved!.context.branchId)}`;
      async function current(): Promise<Status> {
        const state = await json<Status>(api("quick-status"));
        if (state.revision_id !== saved!.context.revisionId)
          throw new Error(
            t(
              "The draft changed in another tab. Reload it before uploading or saving.",
            ),
          );
        saved!.context.branchId = state.branch_id;
        saved!.publicHref = state.public_href;
        persist();
        return state;
      }
      async function select(files: File[], folder: boolean) {
        if (busy || done || selecting) return;
        selecting = true;
        submit.disabled = true;
        try {
          const selected = files
            .map((file) => ({
              file,
              path: uploadPath(file.name, file.webkitRelativePath, folder),
            }))
            .filter(
              (item) =>
                !item.path ||
                (!item.path.split("/").includes(".git") &&
                  !item.path.endsWith(".DS_Store")),
            );
          if (
            selected.some((item) => !item.path || !validPackagePath(item.path))
          )
            throw new Error(
              t(
                "Some file paths cannot be shared. Use the detailed editor to check them.",
              ),
            );
          if (!selected.length)
            throw new Error(t("Choose files before uploading."));
          if (selected.length > 4999)
            throw new Error(t("Choose at most 4999 files."));
          if (
            new Set(selected.map((item) => item.path)).size !== selected.length
          )
            throw new Error(
              t(
                "Duplicate file paths. Choose one folder or remove duplicate names.",
              ),
            );
          for (const item of selected)
            if (!item.file.size || item.file.size > 10 * 1024 ** 3)
              throw new Error(
                t("{path}: choose a non-empty file up to 10 GiB.", {
                  path: item.path!,
                }),
              );
          queue = selected as typeof queue;
          card = "";
          summary = "";
          library = "";
          task = "";
          const readme = queue.find((item) => item.path === "README.md");
          if (readme) {
            if (readme.file.size > CARD_MAX_BYTES)
              throw new Error(
                t(
                  "This README is larger than 100 KB. Shorten it before using it as your card.",
                ),
              );
            card = new TextDecoder("utf-8", { fatal: true }).decode(
              await readme.file.arrayBuffer(),
            );
            const info = cardSuggestions(card);
            summary = info.summary;
            library = info.metadata.library_name ?? "";
            task = info.metadata.pipeline_tag ?? "";
            if (!field("title").value)
              field("title").value = info.title.slice(0, 200);
            if (!field("license").value)
              field("license").value = (info.metadata.license ?? "").slice(
                0,
                120,
              );
          }
          if (!field("title").value) field("title").value = quickTitle(files);
          formats(
            detectShareFormat(
              kind(),
              queue.map((item) => item.path),
              library,
            ),
          );
          form.querySelector<HTMLElement>(
            "[data-quick-selection]",
          )!.textContent =
            `${queue.length === 1 ? t("1 file") : t("{count} files", { count: queue.length })} · ${shareSize(
              queue.reduce((n, item) => n + item.file.size, 0),
              root.dataset.locale,
            )}`;
          note("");
        } catch (error) {
          queue = [];
          note(
            error instanceof Error
              ? error.message
              : t("Could not save. Please retry."),
            true,
          );
        } finally {
          selecting = false;
          if (!busy) submit.disabled = false;
        }
      }
      try {
        const value = JSON.parse(
          sessionStorage.getItem(storeKey) ?? "null",
        ) as Saved | null;
        if (
          value &&
          /^[a-f0-9-]{36}$/.test(value.key) &&
          ["model", "dataset"].includes(value.kind) &&
          value.context &&
          typeof value.slug === "string"
        )
          saved = value;
      } catch {
        /* An invalid local record never creates work. */
      }
      if (saved) {
        form.querySelector<HTMLInputElement>(
          `[name=kind][value=${saved.kind}]`,
        )!.checked = true;
        for (const name of ["title", "license", "basis", "source_url"] as const)
          field(name).value = saved[name];
        if (saved.context.repositoryId) {
          editor.href = local(
            `/repositories/${saved.context.repositoryId}/edit`,
          );
          editor.textContent = t("Open saved draft");
        }
        note(
          t(
            "Your draft is saved. Reselect the same files to resume, or open the draft.",
          ),
        );
        reset.hidden = false;
      }
      formats(saved?.format);
      syncSource();
      open.addEventListener("click", (event) => {
        event.preventDefault();
        dialog.showModal();
      });
      root
        .querySelector("[data-quick-close]")!
        .addEventListener("click", () => dialog.close());
      dialog.addEventListener("close", () => {
        open.focus();
        if (busy)
          open.title = t(
            "Upload is still running. You can close the window; keep this tab open.",
          );
      });
      form
        .querySelectorAll("[name=source],[name=basis]")
        .forEach((input) => input.addEventListener("change", syncSource));
      form.querySelectorAll("[name=kind]").forEach((input) =>
        input.addEventListener("change", () =>
          formats(
            detectShareFormat(
              kind(),
              queue.map((item) => item.path),
              library,
            ),
          ),
        ),
      );
      for (const [selector, folder] of [
        ["[data-quick-files]", false],
        ["[data-quick-folder]", true],
      ] as const) {
        const picker = form.querySelector<HTMLInputElement>(selector)!;
        if (folder) picker.setAttribute("webkitdirectory", "");
        picker.addEventListener("change", (event) => {
          void select(
            Array.from((event.target as HTMLInputElement).files ?? []),
            folder,
          );
        });
      }
      const drop = form.querySelector<HTMLElement>("[data-quick-drop]")!;
      drop.addEventListener("dragover", (event) => event.preventDefault());
      drop.addEventListener("drop", (event) => {
        event.preventDefault();
        if (
          [...(event.dataTransfer?.items ?? [])].some(
            (item) => item.webkitGetAsEntry?.()?.isDirectory,
          )
        ) {
          note(
            t(
              "Up to 10 GiB per file. Use Choose folder to keep nested folders.",
            ),
            true,
          );
          return;
        }
        void select(Array.from(event.dataTransfer?.files ?? []), false);
      });
      reset.addEventListener("click", () => {
        if (busy) return;
        saved = null;
        persist();
        queue = [];
        done = false;
        retry = false;
        card = "";
        summary = "";
        library = "";
        task = "";
        form.reset();
        fields.hidden = false;
        fields.disabled = false;
        form
          .querySelectorAll<HTMLInputElement>("[name=kind],[name=source]")
          .forEach((input) => (input.disabled = false));
        resultBox.hidden = true;
        progressBox.hidden = true;
        submit.hidden = false;
        reset.hidden = true;
        editor.href = local("/new");
        editor.textContent = t("Edit details instead");
        form.querySelector<HTMLElement>("[data-quick-selection]")!.textContent =
          "";
        formats();
        syncSource();
        note("");
        field("title").focus();
      });
      form
        .querySelector("[data-quick-copy]")!
        .addEventListener("click", async () => {
          try {
            await navigator.clipboard.writeText(
              new URL(publicHref, location.origin).href,
            );
            note(t("Link copied"));
          } catch {
            note(new URL(publicHref, location.origin).href);
          }
        });
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (busy || done || selecting || !form.reportValidity()) return;
        const data = Object.fromEntries(new FormData(form));
        const isDrive = drive();
        if (!isDrive && !queue.length) {
          note(t("Choose files before uploading."), true);
          return;
        }
        if (isDrive && !canonicalDriveLink(String(data.drive_url))) {
          note(t("Choose a valid Google Drive file or folder link."), true);
          return;
        }
        busy = true;
        fields.disabled = true;
        submit.disabled = true;
        reset.disabled = true;
        note("");
        progress.value = 0;
        progressBox.hidden = isDrive;
        stage.textContent = t("Uploading");
        try {
          if (isDrive) {
            const result = await json<{ href: string }>(
              "/api/bridge/drive-links",
              {
                ...data,
                confirmed: data.confirmed === "on",
                download_confirmed: data.drive_confirmed === "on",
              },
            );
            finish(result.href);
            return;
          }
          if (!saved) {
            const key = crypto.randomUUID();
            saved = {
              key,
              slug: quickSlug(String(data.title), key),
              title: String(data.title),
              kind: data.kind as ShareKind,
              format: String(data.format),
              license: String(data.license),
              basis: String(data.basis),
              source_url: String(data.source_url ?? ""),
              context: { repositoryId: "", revisionId: "", branchId: "" },
              selection: queue.map((item) => ({
                path: item.path,
                size: item.file.size,
              })),
            };
            persist();
          }
          if (
            saved.selection &&
            (saved.selection.length !== queue.length ||
              saved.selection.some(
                (item) =>
                  !queue.some(
                    (file) =>
                      file.path === item.path && file.file.size === item.size,
                  ),
              ))
          )
            throw new Error(
              t(
                "Reselect the same files to resume this draft, or start another upload.",
              ),
            );
          if (!saved.context.repositoryId) {
            const body = {
              kind: saved.kind,
              slug: saved.slug,
              title: String(data.title),
              license: String(data.license),
              summary,
              library: library || (data.format === "mlx" ? "mlx" : ""),
              task,
              source_urls: data.source_url ? [data.source_url] : [],
            };
            let created: {
              repository_id: string;
              revision_id: string;
              branch_id: string;
            };
            try {
              created = await json<typeof created>("/api/repositories", body);
            } catch (error) {
              // The stable random slug is the effect key. Recover a committed create
              // after a lost response; never create another name on retry.
              const known = await json<{
                repositories: Array<{
                  id: string;
                  revision_id: string;
                  slug: string;
                  kind: string;
                  owner_organization_id: string | null;
                }>;
              }>("/api/repositories");
              const found = known.repositories?.find(
                (r) =>
                  r.slug === saved!.slug &&
                  r.kind === saved!.kind &&
                  !r.owner_organization_id,
              );
              if (!found) throw error;
              created = {
                repository_id: found.id,
                revision_id: found.revision_id,
                branch_id: "",
              };
            }
            saved.context = {
              repositoryId: created.repository_id,
              revisionId: created.revision_id,
              branchId: created.branch_id,
            };
            persist();
          }
          editor.href = local(
            `/repositories/${saved.context.repositoryId}/edit`,
          );
          editor.textContent = t("Open saved draft");
          reset.hidden = false;
          let state = await current();
          if (state.status === "published") {
            finish(state.public_href);
            return;
          }
          if (!["draft", "quarantined", "review"].includes(state.status))
            throw new Error(
              t(
                "Checks need attention. Open your saved draft for the decision and next action.",
              ),
            );
          if (state.status !== "review") {
            const uploader = createUploader(saved.context, t);
            for (let index = 0; index < queue.length; index++) {
              const item = queue[index];
              stage.textContent = `${t("Uploading")} · ${index + 1}/${queue.length}`;
              const existing = state.files.find(
                (file) =>
                  file.path === item.path &&
                  Number(file.size_bytes) === item.file.size,
              );
              if (existing) {
                const digest = sha256.create();
                for (let n = 0; n < item.file.size; n += 8 * 1024 ** 2)
                  digest.update(
                    new Uint8Array(
                      await item.file.slice(n, n + 8 * 1024 ** 2).arrayBuffer(),
                    ),
                  );
                if (bytesToHex(digest.digest()) === existing.sha256) continue;
              }
              await uploader(item.file, item.path, fileStatus, progress);
            }
            const pageCard =
              card ||
              quickCard(
                saved.kind,
                String(data.title),
                String(data.format),
                String(data.license),
                String(data.source_url ?? ""),
              );
            if (!card) {
              const bytes = new TextEncoder().encode(pageCard);
              if (
                !state.files.some(
                  (file) =>
                    file.path === "README.md" &&
                    file.sha256 === bytesToHex(sha256(bytes)),
                )
              )
                await uploader(
                  new File([pageCard], "README.md", {
                    type: "text/markdown",
                    lastModified: 0,
                  }),
                  "README.md",
                  fileStatus,
                  progress,
                );
            }
            state = await current();
            await json(api("presentation"), {
              revision_id: saved.context.revisionId,
              version: state.version,
              title: data.title,
              summary: summary || `Shared ${saved.kind} package.`,
              card_markdown: pageCard,
              task,
              library: library || (data.format === "mlx" ? "mlx" : ""),
            });
            await json(api("publication-metadata"), {
              license: data.license,
              basis: data.basis,
              source_url: data.source_url ?? "",
              confirmed: true,
            });
          }
          stage.textContent = t("Checking");
          progress.removeAttribute("value");
          fileStatus.textContent = t("Files uploaded. Checking this release…");
          const publication = await json(api("submit"), {});
          state = await current();
          if (
            publication.status !== "published" ||
            state.status !== "published"
          )
            throw new Error(
              t(
                "Checks need attention. Open your saved draft for the decision and next action.",
              ),
            );
          finish(state.public_href);
        } catch (error) {
          if (saved?.context.repositoryId) {
            try {
              const state = await current();
              if (state.status === "published") {
                finish(state.public_href);
                return;
              }
            } catch {
              /* Preserve the original failure and draft. */
            }
          }
          stage.textContent = t("Needs attention");
          progress.value = 0;
          note(
            `${error instanceof Error ? error.message : t("Could not save. Please retry.")} ${saved?.context.repositoryId ? t("Completed files are saved. Retry to continue.") : ""}`,
            true,
          );
          retry = true;
        } finally {
          busy = false;
          fields.disabled = false;
          submit.disabled = false;
          reset.disabled = false;
          if (!done) syncSource();
        }
      });
      window.addEventListener("beforeunload", (event) => {
        if (busy) event.preventDefault();
      });
      if (new URL(location.href).searchParams.get("quick") === "1")
        dialog.showModal();
    });
}

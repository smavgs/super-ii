import { ollamaText as t } from "@/lib/ollama-localization";

document
  .querySelectorAll<HTMLAnchorElement>("[data-ollama-download]")
  .forEach((link) => {
    link.addEventListener("click", async (event) => {
      const status =
        link
          .closest("[data-detail-panel]")
          ?.querySelector<HTMLElement>("[data-ollama-download-status]") ??
        document.querySelector<HTMLElement>("[data-ollama-download-status]");
      if (
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      if (link.dataset.starting === "true") {
        event.preventDefault();
        return;
      }
      event.preventDefault();
      link.dataset.starting = "true";
      link.setAttribute("aria-busy", "true");
      if (status) status.textContent = t("Checking the file with Ollama…");
      try {
        const response = await fetch(link.href, { method: "HEAD" });
        if (!response.ok)
          throw new Error(
            response.status === 409
              ? t(
                  "This version changed. Open Files & versions and press Load version to refresh it.",
                )
              : response.status === 429
                ? t("Please wait before starting more downloads.")
                : t("Ollama cannot deliver this file right now. Please retry."),
          );
        const start = document.createElement("a");
        start.href = link.href;
        start.download = link.download;
        document.body.appendChild(start);
        start.click();
        start.remove();
        if (status)
          status.textContent = `Download requested: ${link.download}. Follow progress in your browser’s downloads.`;
      } catch (error) {
        if (status)
          status.textContent =
            error instanceof Error
              ? error.message
              : t("Download unavailable. Please retry.");
      } finally {
        delete link.dataset.starting;
        link.removeAttribute("aria-busy");
      }
    });
  });
const form = document.querySelector<HTMLFormElement>("[data-ollama-editor]");
const editorStatus = form?.querySelector<HTMLElement>(
  "[data-ollama-editor-status]",
);
form
  ?.querySelector("[data-ollama-preview]")
  ?.addEventListener("click", async () => {
    const { renderRepositoryMarkdown } =
      await import("@/lib/repository-markdown");
    const preview = form.querySelector<HTMLElement>(
      "[data-ollama-preview-body]",
    );
    if (preview) {
      preview.innerHTML = renderRepositoryMarkdown(
        String(new FormData(form).get("card_markdown") ?? ""),
      );
      preview.hidden = false;
    }
  });
form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = form.querySelector<HTMLButtonElement>("[type=submit]");
  if (submit) submit.disabled = true;
  if (editorStatus) editorStatus.textContent = t("Saving…");
  try {
    const fields = Object.fromEntries(new FormData(form));
    const response = await fetch(`/api/ollama/${form.dataset.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(fields),
    });
    const result = (await response.json()) as { error?: string };
    if (!response.ok)
      throw new Error(result.error ?? t("Could not save. Please retry."));
    if (editorStatus)
      editorStatus.textContent = t(
        "Saved. Reload the page to see your updated listing.",
      );
  } catch (error) {
    if (editorStatus)
      editorStatus.textContent =
        error instanceof Error
          ? error.message
          : t("Could not save. Please retry.");
  } finally {
    if (submit) submit.disabled = false;
  }
});

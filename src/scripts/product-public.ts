import { translateProduct as t } from "@/lib/product-localization";
const locale = document.documentElement.lang;
const copy = document.querySelector<HTMLButtonElement>("[data-copy-product]");
copy?.addEventListener("click", async () => {
  const status = document.querySelector<HTMLElement>("[data-copy-status]");
  try {
    await navigator.clipboard.writeText(copy.dataset.url ?? location.href);
    if (status) status.textContent = t("Link copied.", locale);
  } catch {
    if (status)
      status.textContent = t("Copy the address from your browser.", locale);
  }
});
const root = document.querySelector<HTMLElement>("[data-product-answer]");
root?.querySelector("form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  const output = root.querySelector<HTMLElement>("[data-answers]")!;
  const button = form.querySelector<HTMLButtonElement>("button")!;
  button.disabled = true;
  output.textContent = t("Searching the published page…", locale);
  try {
    const params = new URLSearchParams({
      question: String(new FormData(form).get("question") ?? ""),
      locale: root.dataset.locale ?? "en",
    });
    const response = await fetch(`${root.dataset.endpoint}?${params}`);
    const data = (await response.json()) as {
      error?: string;
      message: string;
      matches: Array<{ label: string; value: string; source: string }>;
    };
    if (!response.ok) throw new Error(data.error);
    output.replaceChildren();
    const message = document.createElement("p");
    message.textContent = t(data.message, locale);
    output.appendChild(message);
    for (const match of data.matches) {
      const block = document.createElement("p");
      block.setAttribute("data-no-translate", "");
      const label = document.createElement("strong");
      label.textContent = match.label;
      const source = document.createElement("a");
      source.href = match.source;
      source.rel = "noopener noreferrer";
      source.textContent = t("Source", locale);
      block.appendChild(label);
      block.appendChild(document.createTextNode(`: ${match.value} `));
      block.appendChild(source);
      output.appendChild(block);
    }
  } catch {
    output.textContent = t(
      "The published page could not be searched. Please try again.",
      locale,
    );
  } finally {
    button.disabled = false;
  }
});

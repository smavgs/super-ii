for (const group of document.querySelectorAll<HTMLElement>("[data-sigma-actions]")) {
  const status = group.querySelector<HTMLElement>("[data-sigma-action-status]");
  const like = group.querySelector<HTMLButtonElement>("[data-sigma-like]");
  like?.addEventListener("click", async () => {
    if (like.disabled) return;
    const active = like.getAttribute("aria-pressed") !== "true";
    like.disabled = true;
    like.setAttribute("aria-busy", "true");
    if (status) status.textContent = "";
    try {
      const response = await fetch("/api/sigma/likes", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: group.dataset.storyId, active }),
      });
      if (response.status === 401) {
        const target = new URL(group.dataset.signIn ?? "/sign-in", location.origin);
        if (target.origin === location.origin && /^\/(?:ru\/|zh-cn\/)?sign-in$/.test(target.pathname)) location.assign(target.href);
        return;
      }
      if (!response.ok) throw new Error("like unavailable");
      const result = await response.json() as { liked?: boolean; likes_count?: number } | null;
      if (!result || typeof result.liked !== "boolean" || typeof result.likes_count !== "number" || !Number.isSafeInteger(result.likes_count) || result.likes_count < 0) throw new Error("invalid like state");
      for (const related of document.querySelectorAll<HTMLElement>("[data-sigma-actions]")) {
        if (related.dataset.storyId !== group.dataset.storyId) continue;
        const button = related.querySelector<HTMLButtonElement>("[data-sigma-like]");
        const count = related.querySelector<HTMLElement>("[data-like-count]");
        const label = result.liked ? related.dataset.unlikeLabel! : related.dataset.likeLabel!;
        button?.setAttribute("aria-pressed", String(result.liked));
        button?.setAttribute("aria-label", `${label} · ${result.likes_count}`);
        button?.setAttribute("title", label);
        if (count) count.textContent = String(result.likes_count);
      }
      if (result.liked) {
        like.classList.add("sigma-heart-pulse");
        setTimeout(() => like.classList.remove("sigma-heart-pulse"), 400);
      }
    } catch {
      if (status) status.textContent = group.dataset.likeError!;
    } finally {
      like.disabled = false;
      like.removeAttribute("aria-busy");
    }
  });
  const share = group.querySelector<HTMLButtonElement>("[data-sigma-share]");
  share?.addEventListener("click", async () => {
    const url = group.dataset.url!;
    if (status) status.textContent = "";
    if (typeof navigator.share === "function") {
      try { await navigator.share({ title: group.dataset.title!, url }); return; }
      catch (error) { if (error instanceof DOMException && error.name === "AbortError") return; }
    }
    try {
      await navigator.clipboard.writeText(url);
      if (status) status.textContent = group.dataset.copied!;
      document.dispatchEvent(new Event("sigma:thanks"));
    } catch {
      const fallback = group.querySelector<HTMLElement>(".sigma-share-fallback");
      const input = fallback?.querySelector<HTMLInputElement>("input");
      if (fallback) fallback.hidden = false;
      input?.focus();
      input?.select();
    }
  });
}

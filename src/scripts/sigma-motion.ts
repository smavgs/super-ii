export {};
const media = matchMedia("(prefers-reduced-motion: reduce)");
const mascots = [
  ...document.querySelectorAll<HTMLElement>("[data-sigma-mascot]"),
];
const visible = new Set<HTMLElement>();
function update() {
  mascots.forEach((mascot) => {
    mascot.dataset.moving = String(
      !media.matches && !document.hidden && visible.has(mascot),
    );
  });
}
const observer = new IntersectionObserver((entries) => {
  entries.forEach((entry) =>
    entry.isIntersecting
      ? visible.add(entry.target as HTMLElement)
      : visible.delete(entry.target as HTMLElement),
  );
  update();
});
function react(mascot: HTMLElement, reaction: "edition" | "thanks") {
  if (media.matches || document.hidden || !visible.has(mascot)) return;
  mascot.dataset.reaction = reaction;
  setTimeout(() => {
    delete mascot.dataset.reaction;
  }, 750);
}
mascots.forEach((mascot) => {
  observer.observe(mascot);
  const edition = mascot.dataset.edition;
  if (edition)
    setTimeout(() => {
      try {
        if (sessionStorage.getItem("sigma-seen-edition") === edition) return;
        sessionStorage.setItem("sigma-seen-edition", edition);
      } catch {
        /* Optional. */
      }
      react(mascot, "edition");
    }, 400);
});
document.addEventListener("sigma:thanks", () =>
  mascots.forEach((mascot) => react(mascot, "thanks")),
);
document.addEventListener("visibilitychange", update);
media.addEventListener("change", update);
update();

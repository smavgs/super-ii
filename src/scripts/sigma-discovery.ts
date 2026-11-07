const topic = document.querySelector("[data-sigma-topic]");
if (topic instanceof HTMLSelectElement) {
  topic.addEventListener("change", () => topic.form?.requestSubmit());
}
export {};

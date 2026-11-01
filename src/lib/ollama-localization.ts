const messages: Record<string, [string, string]> = {
  "Checking the file with Ollama…": [
    "Проверка файла в Ollama…",
    "正在向 Ollama 检查文件…",
  ],
  "Please wait before starting more downloads.": [
    "Подождите перед следующей загрузкой.",
    "请稍后再开始新的下载。",
  ],
  "Ollama cannot deliver this file right now. Please retry.": [
    "Ollama сейчас не может передать файл. Повторите попытку.",
    "Ollama 暂时无法提供此文件，请重试。",
  ],
  "This version changed. Open Files & versions and press Load version to refresh it.":
    [
      "Версия изменилась. Откройте «Файлы и версии» и обновите сведения о версии.",
      "此版本已更改，请打开“文件与版本”并点击“加载版本”刷新。",
    ],
  "Download unavailable. Please retry.": [
    "Загрузка недоступна. Повторите попытку.",
    "暂时无法下载，请重试。",
  ],
  "Saving…": ["Сохранение…", "正在保存…"],
  "Saved. Reload the page to see your updated listing.": [
    "Сохранено. Обновите страницу, чтобы увидеть изменения.",
    "已保存。请刷新页面查看更新后的条目。",
  ],
  "Could not save. Please retry.": [
    "Не удалось сохранить. Повторите попытку.",
    "无法保存，请重试。",
  ],
};
export function ollamaText(text: string): string {
  const lang = document.documentElement.lang.toLowerCase();
  const pair = messages[text];
  return pair
    ? lang.startsWith("ru")
      ? pair[0]
      : lang.startsWith("zh")
        ? pair[1]
        : text
    : text;
}

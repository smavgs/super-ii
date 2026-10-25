import { translateCreator } from "./creator-localization";
const messages: Array<[string, string, string]> = [
  ["1 file", "1 файл", "1 个文件"],
  [
    "Choose at most 4999 files.",
    "Выберите не более 4999 файлов.",
    "最多选择 4999 个文件。",
  ],
  [
    "Duplicate file paths. Choose one folder or remove duplicate names.",
    "Повторяющиеся пути. Выберите одну папку или удалите дубликаты.",
    "文件路径重复。请选择一个文件夹或移除同名文件。",
  ],
  [
    "Some file paths cannot be shared. Use the detailed editor to check them.",
    "Некоторые пути недопустимы. Проверьте их в подробном редакторе.",
    "部分文件路径无法分享。请使用详细编辑器检查。",
  ],
  [
    "Reselect the same files to resume this draft, or start another upload.",
    "Выберите те же файлы для продолжения или начните другую загрузку.",
    "请重新选择相同文件以继续此草稿，或开始新的上传。",
  ],
  ["Upload now", "Загрузить сейчас", "立即上传"],
  [
    "Share a model or dataset",
    "Поделиться моделью или данными",
    "分享模型或数据集",
  ],
  [
    "Your files become public only after checks pass.",
    "Файлы станут публичными только после проверок.",
    "文件通过检查后才会公开。",
  ],
  ["Model", "Модель", "模型"],
  ["Dataset", "Набор данных", "数据集"],
  ["From my computer", "С моего компьютера", "从我的电脑"],
  ["Use a Google Drive link", "Ссылка Google Drive", "使用 Google Drive 链接"],
  ["Name", "Название", "名称"],
  ["Format", "Формат", "格式"],
  ["Other / not sure", "Другой / не уверен", "其他 / 不确定"],
  ["License", "Лицензия", "许可证"],
  ["Right to share", "Право на публикацию", "分享依据"],
  ["Choose…", "Выберите…", "请选择…"],
  ["My original work", "Моя собственная работа", "我的原创作品"],
  [
    "Permission from the rights holder",
    "Разрешение правообладателя",
    "已获权利人许可",
  ],
  [
    "Redistribution under the source license",
    "Распространение по исходной лицензии",
    "按原许可证再分发",
  ],
  ["Original source URL", "Ссылка на первоисточник", "原始来源链接"],
  [
    "I have the right to share this publicly under this license.",
    "У меня есть право публично распространять это по указанной лицензии.",
    "我有权按此许可证公开分享这些内容。",
  ],
  ["Upload & publish", "Загрузить и опубликовать", "上传并发布"],
  ["Share link", "Поделиться ссылкой", "分享链接"],
  ["Close", "Закрыть", "关闭"],
  ["Edit details instead", "Открыть подробный редактор", "改用详细编辑器"],
  [
    "Drop files here, or choose a folder.",
    "Перетащите файлы или выберите папку.",
    "拖放文件，或选择文件夹。",
  ],
  [
    "Google Drive share link",
    "Общедоступная ссылка Google Drive",
    "Google Drive 分享链接",
  ],
  [
    "Files stay in Drive. Super ii shares the link and does not scan or host those files.",
    "Файлы остаются в Drive. Super ii публикует ссылку, но не хранит и не проверяет эти файлы.",
    "文件保留在 Drive。Super ii 分享链接，不托管或扫描这些文件。",
  ],
  [
    "Allow visitors to download in Drive before sharing. No Google password is needed here.",
    "Перед публикацией разрешите посетителям скачивание в Drive. Пароль Google здесь не нужен.",
    "分享前，请在 Drive 中允许访客下载。此处不需要 Google 密码。",
  ],
  [
    "I checked that visitors can download using this link.",
    "Я проверил, что посетители могут скачивать по этой ссылке.",
    "我已确认访客可通过此链接下载。",
  ],
  [
    "Choose files before uploading.",
    "Сначала выберите файлы.",
    "请先选择要上传的文件。",
  ],
  [
    "Choose a valid Google Drive file or folder link.",
    "Укажите ссылку на файл или папку Google Drive.",
    "请输入有效的 Google Drive 文件或文件夹链接。",
  ],
  ["Uploading", "Загрузка", "正在上传"],
  ["Checking", "Проверка", "正在检查"],
  ["Ready to share", "Готово к публикации", "可以分享了"],
  ["Needs attention", "Требуется внимание", "需要处理"],
  ["Retry", "Повторить", "重试"],
  ["Open page", "Открыть страницу", "打开页面"],
  ["Copy link", "Копировать ссылку", "复制链接"],
  ["Link copied", "Ссылка скопирована", "链接已复制"],
  ["Open saved draft", "Открыть черновик", "打开已保存的草稿"],
  [
    "Keep this tab open until the upload finishes.",
    "Не закрывайте вкладку до завершения загрузки.",
    "上传完成前请保持此标签页打开。",
  ],
  [
    "Upload is still running. You can close the window; keep this tab open.",
    "Загрузка продолжается. Можно закрыть окно, но не вкладку.",
    "上传仍在进行。可以关闭弹窗，但请保留此标签页。",
  ],
  [
    "Your draft is saved. Reselect the same files to resume, or open the draft.",
    "Черновик сохранён. Выберите те же файлы для продолжения или откройте черновик.",
    "草稿已保存。重新选择相同文件以继续，或打开草稿。",
  ],
  ["Start another upload", "Начать другую загрузку", "开始新的上传"],
  [
    "Files uploaded. Checking this release…",
    "Файлы загружены. Проверяем релиз…",
    "文件已上传。正在检查此版本…",
  ],
  [
    "Checks need attention. Open your saved draft for the decision and next action.",
    "Проверки требуют внимания. Откройте черновик для просмотра решения.",
    "检查需要处理。请打开已保存的草稿查看结果和下一步操作。",
  ],
  [
    "Completed files are saved. Retry to continue.",
    "Готовые файлы сохранены. Повторите для продолжения.",
    "已完成的文件已保存。重试以继续。",
  ],
  ["Download", "Скачать", "下载"],
  ["Complete package", "Полный пакет", "完整文件包"],
  [
    "Download from Google Drive",
    "Скачать из Google Drive",
    "从 Google Drive 下载",
  ],
  [
    "External files · Google Drive",
    "Внешние файлы · Google Drive",
    "外部文件 · Google Drive",
  ],
  ["Open shared page", "Открыть страницу", "打开分享页面"],
  ["Shared by", "Поделился", "分享者"],
  [
    "These external files have not been checked by Super ii. Availability and access are controlled by the Drive owner.",
    "Super ii не проверял эти внешние файлы. Доступность и доступ зависят от владельца Drive.",
    "这些外部文件未经 Super ii 检查。可用性和访问权限由 Drive 所有者控制。",
  ],
];
export const quickShareRussian = Object.fromEntries(
  messages.map(([en, ru]) => [en, ru]),
);
export const quickShareChinese = Object.fromEntries(
  messages.map(([en, , zh]) => [en, zh]),
);
export function shareText(
  text: string,
  locale = "en",
  values: Record<string, string | number> = {},
) {
  const result =
    (locale === "ru"
      ? quickShareRussian[text]
      : locale === "zh-CN"
        ? quickShareChinese[text]
        : text) ?? translateCreator(text, locale, values);
  return result.replace(/\{(\w+)\}/g, (match, key) =>
    String(values[key] ?? match),
  );
}

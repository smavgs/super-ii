import type { SiteLocale } from './i18n';

// Match the existing profile allocator's 30-character input limit. A check
// never reserves a name: the database unique index decides at account creation.
export const HANDLE_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,28}[a-z0-9])?$/;
export const RESERVED_HANDLES = new Set(['admin', 'administrator', 'support', 'superii', 'super-ii', 'moderator', 'security', 'system']);
export function requestedHandle(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 32) return null;
  const handle = value.trim().toLowerCase().replace(/^@/, '');
  return HANDLE_PATTERN.test(handle) && !RESERVED_HANDLES.has(handle) ? handle : null;
}

export const welcomeCopy = {
  en: {
    invite: 'Your place in Super ii.', compact: 'Claim your handle', label: 'Your Super ii handle',
    check: 'Check', checking: 'Checking…', join: 'Join free', close: 'Collapse handle invitation',
    hint: '1–30 letters, numbers or hyphens. Free to join.',
    invalid: 'Use 1–30 letters, numbers or hyphens. Start and end with a letter or number.',
    unavailable: 'That handle is unavailable. Try another.',
    available: 'Available now. Finish signup to claim it.',
    failed: 'We couldn’t check just now. Please try again.', limited: 'A few too many checks. Please try again shortly.',
    chosen: 'Your chosen handle', pending: 'We’ll check it again when your account is created.',
    result: 'Your Super ii handle', conflict: 'Your first choice was taken before signup finished. This is your handle:',
    settings: 'Cookie choices', privacyTitle: 'Help us improve Super ii?',
    privacyIntro: 'Optional analytics help us understand which pages and features get used.',
    allow: 'Allow', decline: 'No thanks', details: 'Details', privacyLink: 'Privacy policy',
    detail: 'With your permission, we count broad actions such as opening signup or clicking a download. No typed handles, private messages, full URLs or visitor IDs are included in these counters. Daily totals are kept for up to 90 days.',
    necessary: 'Sign-in and security still work either way. Existing Cloudflare performance measurement is cookieless and separate from these optional counters.',
    remember: 'This choice is saved for 6 months. Change it anytime in the footer.',
    on: 'Optional analytics are on.', off: 'Optional analytics are off.',
  },
  ru: {
    invite: 'Ваше место в Super ii.', compact: 'Выберите свой ник', label: 'Ваш ник в Super ii',
    check: 'Проверить', checking: 'Проверяем…', join: 'Регистрация', close: 'Свернуть выбор ника',
    hint: '1–30 латинских букв, цифр или дефисов. Бесплатно.',
    invalid: 'От 1 до 30 латинских букв, цифр или дефисов. В начале и конце — буква или цифра.',
    unavailable: 'Этот ник недоступен. Попробуйте другой.',
    available: 'Сейчас свободен. Завершите регистрацию, чтобы занять его.',
    failed: 'Не удалось проверить. Попробуйте ещё раз.', limited: 'Слишком много проверок. Попробуйте чуть позже.',
    chosen: 'Выбранный ник', pending: 'Проверим его ещё раз при создании аккаунта.',
    result: 'Ваш ник в Super ii', conflict: 'Первый ник успели занять до завершения регистрации. Ваш ник:',
    settings: 'Настройки cookies', privacyTitle: 'Поможете улучшить Super ii?',
    privacyIntro: 'Необязательная аналитика помогает понять, какими страницами и функциями пользуются.',
    allow: 'Разрешить', decline: 'Нет, спасибо', details: 'Подробнее', privacyLink: 'Конфиденциальность',
    detail: 'С вашего разрешения считаем общие действия: например, открытие регистрации или нажатие на скачивание. В эти счётчики не попадают введённые ники, личные сообщения, полные URL и идентификаторы посетителей. Дневные итоги хранятся до 90 дней.',
    necessary: 'Вход и защита работают при любом выборе. Отдельное измерение производительности Cloudflare не использует cookies.',
    remember: 'Выбор сохраняется на 6 месяцев. Изменить его можно внизу страницы.',
    on: 'Необязательная аналитика включена.', off: 'Необязательная аналитика выключена.',
  },
  'zh-CN': {
    invite: '在 Super ii 找到你的空间。', compact: '选择你的用户名', label: '你的 Super ii 用户名',
    check: '查询', checking: '查询中…', join: '免费注册', close: '收起用户名栏',
    hint: '1–30 个英文字母、数字或连字符。免费加入。',
    invalid: '请输入 1–30 个英文字母、数字或连字符，首尾须为字母或数字。',
    unavailable: '此用户名不可用，请换一个。', available: '目前可用。完成注册即可获得。',
    failed: '暂时无法查询，请重试。', limited: '查询次数过多，请稍后重试。',
    chosen: '你选择的用户名', pending: '创建账户时我们会再次确认是否可用。',
    result: '你的 Super ii 用户名', conflict: '注册完成前，原用户名已被占用。你的用户名是：',
    settings: 'Cookie 选项', privacyTitle: '帮助改进 Super ii？',
    privacyIntro: '可选分析帮助我们了解哪些页面和功能有人使用。',
    allow: '允许', decline: '不用，谢谢', details: '详情', privacyLink: '隐私政策',
    detail: '经你同意，我们会统计打开注册页、点击下载等大类操作。这些计数不包含输入的用户名、私信、完整网址或访客标识。每日汇总最多保留 90 天。',
    necessary: '无论你如何选择，登录和安全功能均可正常使用。现有 Cloudflare 性能测量不使用 Cookie，与这些可选计数独立。',
    remember: '此选择保存 6 个月，随时可在页脚更改。',
    on: '可选分析已开启。', off: '可选分析已关闭。',
  },
} satisfies Record<SiteLocale, Record<string, string>>;

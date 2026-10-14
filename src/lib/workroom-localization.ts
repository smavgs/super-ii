// Interface language only. Creator-authored goals and evidence retain their language.
const messages: Record<string, [string, string]> = {
  "Repository type": ["Тип репозитория", "仓库类型"],
  "My cards": ["Мои карточки", "我的名片"],
  "Resume a workroom, open a repository or start something new.": ["Продолжите работу в комнате, откройте репозиторий или начните новое дело.", "继续工作室中的任务、打开仓库或开始新工作。"],
  "Published": ["Опубликовано", "已发布"],
  "Draft": ["Черновик", "草稿"],
  "In review": ["На проверке", "审核中"],
  "Rejected": ["Отклонено", "已拒绝"],
  "Create & upload": ["Создать и загрузить", "创建与上传"],
  "Edit page": ["Редактировать страницу", "编辑页面"],
  "View files": ["Открыть файлы", "查看文件"],
  "View source": ["Открыть источник", "查看来源"],
  "New workroom": ["Новая рабочая комната", "新建工作室"],
  "Set up your AI": ["Настройте свой ИИ", "设置您的 AI"],
  "AI guides and tools": ["Руководства и инструменты ИИ", "AI 指南与工具"],
  "Cloud guide": ["Облачный ИИ", "云端指南"],
  "Local guide": ["Локальный ИИ", "本地指南"],
  "Connect your agent": ["Подключить агента", "连接您的智能体"],
  "Plan your next step (optional)": ["Запланируйте следующий шаг (необязательно)", "规划下一步（可选）"],
  "Connect a repository or team (optional)": ["Свяжите репозиторий или команду (необязательно)", "关联仓库或团队（可选）"],
  Notebook: ["Блокнот", "笔记本"],
  "Current work": ["Текущая работа", "当前工作"],
  Component: ["Компонент", "组件"],
  Breadcrumb: ["Навигационная цепочка", "面包屑导航"],
  Complete: ["Завершено", "已完成"],
  Blocked: ["Заблокировано", "受阻"],
  "Team workroom": ["Командная рабочая комната", "团队工作室"],
  "Personal workroom": ["Личная рабочая комната", "个人工作室"],
  "Reported result": ["Сообщённый результат", "报告的结果"],
  Blocker: ["Препятствие", "阻碍"],
  Note: ["Заметка", "笔记"],
  "External versions are supplied references. No source files have been imported or executed by this workroom.":
    [
      "Внешние версии указаны автором. Комната не импортировала и не запускала файлы источника.",
      "外部版本由用户提供作参考。此工作室未导入或执行任何来源文件。",
    ],
  "Another update arrived. Copy your unsaved text, then reload before saving.":
    [
      "Появилось другое обновление. Скопируйте несохранённый текст, затем перезагрузите страницу перед сохранением.",
      "有新的更新。请复制未保存的文字，重新加载后再保存。",
    ],
  "This workroom or source is unavailable to you.": [
    "Эта комната или источник вам недоступны.",
    "您无法访问此工作室或来源。",
  ],
  "Add a result and select the result you reviewed before marking work complete.":
    [
      "Добавьте результат и выберите проверенный вами результат, прежде чем отмечать выполнение.",
      "标记完成前，请添加结果并选择您已审阅的结果。",
    ],
  "Use the exact handle of an existing public member profile.": [
    "Укажите точное имя существующего публичного профиля участника.",
    "请输入现有公开成员资料的准确用户名。",
  ],
  "Workrooms are temporarily unavailable. Your unsaved text is still here.": [
    "Рабочие комнаты временно недоступны. Несохранённый текст остался на странице.",
    "工作室暂时不可用。未保存的文字仍保留在此处。",
  ],
  "Work in progress": ["Работа в процессе", "进行中的工作"],
  "Keep your goal, next action and results together.": [
    "Храните цель, следующий шаг и результаты вместе.",
    "将目标、下一步和结果保存在一起。",
  ],
  "Start work": ["Начать работу", "开始工作"],
  "Find a workroom": ["Найти рабочую комнату", "查找工作室"],
  "Search your work": ["Поиск вашей работы", "搜索您的工作"],
  Workroom: ["Рабочая комната", "工作室"],
  "Your workroom": ["Ваша рабочая комната", "您的工作室"],
  "Your goal, progress and results.": [
    "Ваша цель, ход работы и результаты.",
    "您的目标、进展与结果。",
  ],
  "All work": ["Вся работа", "全部工作"],
  "In progress": ["В процессе", "进行中"],
  "Ready to review": ["Готово к проверке", "待审阅"],
  "Show more workrooms": ["Показать ещё комнаты", "显示更多工作室"],
  "Loading your workrooms…": [
    "Загрузка рабочих комнат…",
    "正在加载您的工作室…",
  ],
  "Loading your Workspace…": [
    "Загрузка рабочего пространства…",
    "正在加载您的工作空间…",
  ],
  "What do you want to work on?": [
    "Над чем вы хотите работать?",
    "您想开展什么工作？",
  ],
  "Start with an idea, a repository or a link. A personal workroom needs no company.":
    [
      "Начните с идеи, репозитория или ссылки. Для личной комнаты компания не нужна.",
      "从想法、仓库或链接开始。个人工作室无需创建公司。",
    ],
  "Set up your workroom": ["Настройте рабочую комнату", "设置您的工作室"],
  "Kind of work": ["Вид работы", "工作类型"],
  "A short name for your work": [
    "Краткое название работы",
    "为工作起一个简短名称",
  ],
  "What do you want to achieve?": [
    "Какого результата вы хотите достичь?",
    "您希望实现什么目标？",
  ],
  "Describe the result you want.": [
    "Опишите нужный результат.",
    "描述您希望获得的结果。",
  ],
  "How will you know it is ready?": [
    "Как вы определите, что работа готова?",
    "如何判断工作已完成？",
  ],
  "The checks or result you want to review.": [
    "Проверки или результат, которые вы хотите оценить.",
    "您希望审阅的检查项或结果。",
  ],
  "Reviewed result": ["Проверенный результат", "已审阅的结果"],
  "Next action": ["Следующий шаг", "下一步"],
  "One useful thing to do next": [
    "Один полезный следующий шаг",
    "下一项有用的行动",
  ],
  "Who is this for?": ["Для кого эта работа?", "这项工作属于谁？"],
  "Just me": ["Только для меня", "仅我自己"],
  "Existing repository (optional)": [
    "Существующий репозиторий (необязательно)",
    "现有仓库（可选）",
  ],
  "Start without a repository": ["Начать без репозитория", "不关联仓库开始"],
  "Source link and version (optional)": [
    "Ссылка на источник и версия (необязательно)",
    "来源链接与版本（可选）",
  ],
  "Source link": ["Ссылка на источник", "来源链接"],
  "Source version you are using": [
    "Используемая версия источника",
    "您正在使用的来源版本",
  ],
  "A commit, release or version, if known": [
    "Коммит, выпуск или версия, если известны",
    "提交、发行版或版本号（如已知）",
  ],
  "Keep a link from GitHub, GitLab, Codeberg, Hugging Face or another public website. This saves a reference; it does not import or run its files. Keep credentials out of links.":
    [
      "Сохраните ссылку с GitHub, GitLab, Codeberg, Hugging Face или другого публичного сайта. Это только ссылка: файлы не импортируются и не запускаются. Не включайте учётные данные в ссылки.",
      "保存 GitHub、GitLab、Codeberg、Hugging Face 或其他公开网站的链接。这只保存引用，不会导入或运行文件。请勿在链接中包含凭据。",
    ],
  "Create workroom": ["Создать рабочую комнату", "创建工作室"],
  "Goal and source": ["Цель и источник", "目标与来源"],
  "Results and notes": ["Результаты и заметки", "结果与笔记"],
  "Keep decisions, results and blockers here. Uploaded files stay in their repository; link the result below.":
    [
      "Храните здесь решения, результаты и препятствия. Загруженные файлы остаются в репозитории; добавьте ссылку на результат ниже.",
      "在此记录决定、结果和阻碍。上传的文件保留在仓库中；您可在下方添加结果链接。",
    ],
  "A note or decision": ["Заметка или решение", "笔记或决定"],
  "A result for review": ["Результат для проверки", "待审阅的结果"],
  "A blocker": ["Препятствие", "阻碍"],
  "What happened?": ["Что произошло?", "发生了什么？"],
  "Result link and checksum (optional)": [
    "Ссылка на результат и контрольная сумма (необязательно)",
    "结果链接与校验和（可选）",
  ],
  "Result or evidence link": [
    "Ссылка на результат или подтверждение",
    "结果或证据链接",
  ],
  "If you have a file checksum": [
    "Если у вас есть контрольная сумма файла",
    "如有文件校验和",
  ],
  "Save entry": ["Сохранить запись", "保存记录"],
  "Show earlier entries": ["Показать предыдущие записи", "显示更早的记录"],
  "Result I reviewed": ["Проверенный мной результат", "我已审阅的结果"],
  "Select a saved result": [
    "Выберите сохранённый результат",
    "选择已保存的结果",
  ],
  "Mark complete after checking the result against your goal. This records your review; it does not independently verify execution or publish anything.":
    [
      "Отметьте выполнение после проверки результата относительно цели. Это фиксирует вашу оценку, но не является независимой проверкой выполнения и ничего не публикует.",
      "根据目标检查结果后再标记完成。此操作记录您的审阅，并不独立验证执行情况，也不会发布内容。",
    ],
  "People and agents": ["Люди и агенты", "成员与智能体"],
  "Member's public handle": ["Публичное имя участника", "成员的公开用户名"],
  "Can view": ["Может просматривать", "可查看"],
  "Can edit and add results": [
    "Может редактировать и добавлять результаты",
    "可编辑并添加结果",
  ],
  "Give access": ["Предоставить доступ", "授予访问权限"],
  "Remove access": ["Закрыть доступ", "移除访问权限"],
  "Access includes the goal, source references and result history. This does not share the underlying repository or its files.":
    [
      "Доступ включает цель, ссылки на источники и историю результатов. Он не открывает доступ к самому репозиторию или его файлам.",
      "访问权限涵盖目标、来源引用和结果历史，不会共享底层仓库或文件。",
    ],
  "Continue with your agent": [
    "Продолжить с вашим агентом",
    "与您的智能体继续工作",
  ],
  "Download a handoff containing this workroom's goal, source and reported entries. Share it only with an agent you choose.":
    [
      "Скачайте файл передачи с целью, источником и сообщёнными результатами. Передавайте его только выбранному вами агенту.",
      "下载包含工作室目标、来源与报告记录的交接文件。仅与您选择的智能体共享。",
    ],
  "Download handoff": ["Скачать файл передачи", "下载交接文件"],
  "Manage agent access": ["Управление доступом агентов", "管理智能体访问权限"],
  "Create a repository": ["Создать репозиторий", "创建仓库"],
  "Open notebook guides": [
    "Открыть руководства по блокнотам",
    "打开笔记本指南",
  ],
  "Prepare a runnable project": [
    "Подготовить запускаемый проект",
    "准备可运行的项目",
  ],
  "Generate a pinned local recipe for supported published inputs.": [
    "Создайте локальный рецепт с закреплёнными версиями поддерживаемых опубликованных данных.",
    "使用支持的已发布输入生成固定版本的本地方案。",
  ],
  "Read or download a notebook. Execution depends on its supported environment.":
    [
      "Читайте или скачайте блокнот. Запуск зависит от поддерживаемой среды.",
      "阅读或下载笔记本。能否执行取决于其支持的环境。",
    ],
  "Save files and documentation, then attach the result here.": [
    "Сохраните файлы и документацию, затем добавьте результат здесь.",
    "保存文件和文档，然后在此附上结果。",
  ],
  "Present a product": ["Представить продукт", "展示产品"],
  "Create the company and product presentation when you are ready.": [
    "Создайте представление компании и продукта, когда будете готовы.",
    "准备好后创建公司与产品介绍。",
  ],
  "Try loading again": ["Загрузить снова", "重新加载"],
  "Sign in to open your workrooms.": [
    "Войдите, чтобы открыть рабочие комнаты.",
    "请登录以打开您的工作室。",
  ],
  "No workrooms match this view.": [
    "Нет комнат, соответствующих этому фильтру.",
    "此视图中没有匹配的工作室。",
  ],
  "Start a workroom to save a goal and continue where you left off.": [
    "Создайте комнату, чтобы сохранить цель и продолжить с места остановки.",
    "创建工作室，保存目标并随时继续工作。",
  ],
  "No entries yet. Save a decision, a result or what is blocking progress.": [
    "Записей пока нет. Сохраните решение, результат или препятствие.",
    "还没有记录。保存决定、结果或阻碍进展的问题。",
  ],
  "Only the owner and members explicitly added below can open this workroom.": [
    "Только владелец и добавленные ниже участники могут открыть эту комнату.",
    "只有所有者和下方明确添加的成员才能打开此工作室。",
  ],
  "Members of this organization can view this room. Owners, admins and maintainers can edit. Team membership controls access.":
    [
      "Участники организации могут просматривать комнату. Владельцы, администраторы и сопровождающие могут редактировать. Доступ определяется членством в команде.",
      "此组织成员可以查看工作室，所有者、管理员和维护者可以编辑。访问权限由团队成员资格控制。",
    ],
  "A handoff grants no account access. Direct agent reports currently require a team workroom bound to a repository; personal work can use the handoff and save reviewed results here.":
    [
      "Файл передачи не даёт доступа к аккаунту. Для прямых отчётов агента нужна командная комната, связанная с репозиторием. Для личной работы можно передать файл и сохранить проверенные результаты здесь.",
      "交接文件不授予账户访问权限。智能体直接报告目前需要绑定仓库的团队工作室；个人工作可以使用交接文件，并在此保存审阅后的结果。",
    ],
  "A repository-scoped agent connection can read this room or report progress when you explicitly grant workroom:read or workroom:report. Agent results wait for member review.":
    [
      "Агент с доступом к этому репозиторию может читать комнату или сообщать о ходе работы, если вы явно предоставите workroom:read или workroom:report. Результаты агента ожидают проверки участником.",
      "仅在您明确授予 workroom:read 或 workroom:report 后，受仓库范围限制的智能体连接才能读取此工作室或报告进展。智能体结果需等待成员审阅。",
    ],
  "Save plan to workroom": ["Сохранить план в комнату", "将方案保存到工作室"],
  "Plan saved to your workroom. No execution or completion has been claimed.": [
    "План сохранён в комнате. Запуск или выполнение не заявлены.",
    "方案已保存到工作室。尚未声明执行或完成。",
  ],
  "Workroom saved.": ["Комната сохранена.", "工作室已保存。"],
  "Saved as complete with your reviewed result.": [
    "Отмечено выполнение с проверенным вами результатом.",
    "已根据您审阅的结果标记完成。",
  ],
  "Entry saved. Results remain reported until you review them.": [
    "Запись сохранена. Результаты остаются сообщёнными до вашей проверки.",
    "记录已保存。在您审阅之前，结果仍标注为报告内容。",
  ],
  "Downloaded the saved workroom. Unsaved form changes are not included.": [
    "Сохранённая комната скачана. Несохранённые изменения формы не включены.",
    "已下载保存的工作室。不包含表单中未保存的更改。",
  ],
};
export const workroomRussian = Object.fromEntries(
  Object.entries(messages).map(([source, pair]) => [source, pair[0]]),
);
export const workroomChinese = Object.fromEntries(
  Object.entries(messages).map(([source, pair]) => [source, pair[1]]),
);

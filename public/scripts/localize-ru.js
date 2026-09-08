(() => {
  if (document.documentElement.lang !== 'ru') return;

  const excluded = new Set(['SCRIPT', 'STYLE', 'PRE', 'CODE', 'SAMP', 'KBD', 'TEXTAREA', 'TEMPLATE', 'SVG']);
  let messages = {};
  let reviewedMessages = {};

  const normalize = (value) => value.replace(/\s+/g, ' ').trim();
  const plural = (count, one, few, many) => {
    const mod10 = count % 10;
    const mod100 = count % 100;
    if (mod10 === 1 && mod100 !== 11) return one;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
    return many;
  };
  const exact = (value) => messages[value] || value;
  const translateDynamic = (value) => {
    let match = value.match(/^(\d+) of (\d+) complete$/);
    if (match) return `${match[1]} из ${match[2]} выполнено`;
    match = value.match(/^(\d+) selected$/);
    if (match) return `Выбрано: ${match[1]}`;
    match = value.match(/^([\d.,\s\u00a0]+) bytes$/);
    if (match) return `${match[1].trim()} байт`;
    match = value.match(/^Open (model|dataset|app)$/);
    if (match) return `Открыть ${exact(match[1])}`;
    match = value.match(/^Results for [“"](.+)[”"]$/);
    if (match) return `Результаты по запросу «${match[1]}»`;
    match = value.match(/^Page (\d+) of (\d+)$/);
    if (match) return `Страница ${match[1]} из ${match[2]}`;
    match = value.match(/^View (.+?)[’']s public profile$/);
    if (match) return `Открыть публичный профиль ${match[1]}`;
    match = value.match(/^(.+?)[’']s interests$/);
    if (match) return `Интересы ${match[1]}`;
    match = value.match(/^(.+?)[’']s public activity$/);
    if (match) return `Публичная активность ${match[1]}`;
    match = value.match(/^See all promoted (models|datasets|apps)$/);
    if (match) return `Посмотреть все продвигаемые ${exact(match[1])}`;
    match = value.match(/^No active (models|datasets|apps) promotions yet\. Reviewed public work can reserve equal rotation here\.$/);
    if (match) return `Активного продвижения в разделе «${exact(match[1])}» пока нет. Проверенный публичный проект может получить здесь равную ротацию.`;
    match = value.match(/^(\d+) (file|files|row|rows|builder|builders|repository|repositories|item|items|post|posts|reply|replies|place|places|comment|comments|vote|votes|download|downloads|cell|cells)$/);
    if (match) {
      const count = Number(match[1]);
      const forms = {
        file: ['файл', 'файла', 'файлов'], files: ['файл', 'файла', 'файлов'],
        row: ['строка', 'строки', 'строк'], rows: ['строка', 'строки', 'строк'],
        builder: ['создатель', 'создателя', 'создателей'], builders: ['создатель', 'создателя', 'создателей'],
        repository: ['репозиторий', 'репозитория', 'репозиториев'], repositories: ['репозиторий', 'репозитория', 'репозиториев'],
        item: ['элемент', 'элемента', 'элементов'], items: ['элемент', 'элемента', 'элементов'],
        post: ['публикация', 'публикации', 'публикаций'], posts: ['публикация', 'публикации', 'публикаций'],
        reply: ['ответ', 'ответа', 'ответов'], replies: ['ответ', 'ответа', 'ответов'],
        place: ['место', 'места', 'мест'], places: ['место', 'места', 'мест'],
        comment: ['комментарий', 'комментария', 'комментариев'], comments: ['комментарий', 'комментария', 'комментариев'],
        vote: ['голос', 'голоса', 'голосов'], votes: ['голос', 'голоса', 'голосов'],
        download: ['загрузка', 'загрузки', 'загрузок'], downloads: ['загрузка', 'загрузки', 'загрузок'],
        cell: ['ячейка', 'ячейки', 'ячеек'], cells: ['ячейка', 'ячейки', 'ячеек'],
      };
      return `${count} ${plural(count, ...forms[match[2]])}`;
    }
    match = value.match(/^(\d+) (?:skill|skills)(?: in (.+))?$/);
    if (match) {
      const count = Number(match[1]);
      return `${count} ${plural(count, 'навык', 'навыка', 'навыков')}${match[2] ? ` в категории «${exact(match[2])}»` : ''}`;
    }
    match = value.match(/^Open (.+) skill$/);
    if (match) return `Открыть навык «${match[1]}»`;
    match = value.match(/^Open (.+) organization$/);
    if (match) return `Открыть организацию «${match[1]}»`;
    match = value.match(/^Open (.+?)[’']s public profile$/);
    if (match) return `Открыть публичный профиль ${match[1]}`;
    match = value.match(/^Open (.+)$/);
    if (match) return `Открыть «${match[1]}»`;
    match = value.match(/^Dataset preview: (.+)$/);
    if (match) return `Предпросмотр набора данных: ${match[1]}`;
    match = value.match(/^PDF preview: (.+)$/);
    if (match) return `Предпросмотр PDF: ${match[1]}`;
    match = value.match(/^Link to cell (\d+)$/);
    if (match) return `Ссылка на ячейку ${match[1]}`;
    match = value.match(/^Outputs for cell (\d+)$/);
    if (match) return `Результаты ячейки ${match[1]}`;
    match = value.match(/^Static output from cell (\d+)$/);
    if (match) return `Статический результат ячейки ${match[1]}`;
    match = value.match(/^Disconnect @(.+)$/);
    if (match) return `Отключить @${match[1]}`;
    match = value.match(/^No matching (.+)$/);
    if (match) return `Нет подходящих результатов: ${exact(match[1])}`;
    match = value.match(/^No (.+) match “(.+)”\. Only reviewed public releases are searchable\.$/);
    if (match) return `По запросу «${match[2]}» ничего не найдено в разделе «${exact(match[1])}». В поиске участвуют только проверенные публичные релизы.`;
    match = value.match(/^(.+) instructions selected\.$/);
    if (match) return `Выбраны инструкции для ${exact(match[1])}.`;
    match = value.match(/^Hashing (.+)… (\d+)%$/);
    if (match) return `Вычисляем хеш файла ${match[1]}… ${match[2]}%`;
    match = value.match(/^Uploading (.+)… (\d+)%$/);
    if (match) return `Загружаем файл ${match[1]}… ${match[2]}%`;
    match = value.match(/^Scanning (.+) in quarantine…$/);
    if (match) return `Проверяем файл ${match[1]} в карантине…`;
    match = value.match(/^Completed locally with (.+)\.$/);
    if (match) return `Локальное выполнение завершено на ${match[1]}.`;
    match = value.match(/^Completed offline · seed (.+)$/);
    if (match) return `Офлайн-выполнение завершено · seed ${match[1]}`;
    match = value.match(/^Build ready · (\d+) files · locked image\.$/);
    if (match) {
      const count = Number(match[1]);
      return `Сборка готова · ${count} ${plural(count, 'файл', 'файла', 'файлов')} · зафиксированный образ.`;
    }
    match = value.match(/^Watching (.+)\.$/);
    if (match) return `Уровень наблюдения: ${exact(match[1])}.`;
    match = value.match(/^(\d+) found · (\d+) ready now$/);
    if (match) return `Найдено: ${match[1]} · готово сейчас: ${match[2]}`;
    match = value.match(/^(model|dataset|space|app) · (\d+) files · (.+) · (.+)$/);
    if (match) {
      const count = Number(match[2]);
      return `${exact(match[1])} · ${count} ${plural(count, 'файл', 'файла', 'файлов')} · ${match[3]} · ${exact(match[4])}`;
    }
    match = value.match(/^(\d+)\/(\d+) orders · \$(.+) of \$(.+) authorized · (.+) · expires (.+)$/);
    if (match) return `${match[1]}/${match[2]} заказов · авторизовано $${match[3]} из $${match[4]} · ${match[5]} · срок до ${match[6]}`;
    match = value.match(/^(\d+)\/(\d+) actions · (.+) · expires (.+)$/);
    if (match) return `${match[1]}/${match[2]} действий · ${match[3]} · срок до ${match[4]}`;
    match = value.match(/^(.+) · (\d+)\/(\d+) slots used$/);
    if (match) return `${match[1]} · использовано мест: ${match[2]} из ${match[3]}`;
    match = value.match(/^Loading (.+) posts…$/);
    if (match) return `Загружаем публикации: ${exact(match[1])}…`;
    match = value.match(/^(\d+) public (?:post|posts) shown\.$/);
    if (match) {
      const count = Number(match[1]);
      return `Показано ${count} ${plural(count, 'публичная публикация', 'публичные публикации', 'публичных публикаций')}.`;
    }
    match = value.match(/^Pairing code ready for @(.+)\.$/);
    if (match) return `Код подключения для @${match[1]} готов.`;
    match = value.match(/^(Pause|Resume|Revoke) in progress…$/);
    if (match) return `${exact(match[1])}: выполняется…`;
    match = value.match(/^Agent (pause|resume|revoke) completed\.$/);
    if (match) return `Действие «${exact(match[1])}» для агента выполнено.`;
    match = value.match(/^(.+) created\. Create a pairing code in the next panel\.$/);
    if (match) return `${match[1]} создан. Создайте код подключения в следующей панели.`;
    match = value.match(/^(Follow|Like) saved\.$/);
    if (match) return `${exact(match[1])}: сохранено.`;
    match = value.match(/^Payment status: (.+)\.$/);
    if (match) return `Статус оплаты: ${exact(match[1])}.`;
    match = value.match(/^USDC · Ethereum · (\$[\d,.]+) total(?: for (\d+) seats)? · (30 days|12 months)$/);
    if (match) {
      const seatCount = match[2] ? Number(match[2]) : null;
      const seats = seatCount === null
        ? ''
        : ` за ${seatCount} ${plural(seatCount, 'место', 'места', 'мест')}`;
      return `USDC · Ethereum · итого ${match[1]}${seats} · ${match[3] === '12 months' ? '12 месяцев' : '30 дней'}`;
    }
    match = value.match(/^Request failed \((\d+)\)$/);
    if (match) return `Запрос завершился ошибкой (${match[1]})`;
    return value;
  };
  const translate = (value) => {
    const key = normalize(value);
    if (!key) return value;
    if (Object.hasOwn(reviewedMessages, key)) {
      const leading = value.match(/^\s*/)?.[0] || '';
      const trailing = value.match(/\s*$/)?.[0] || '';
      return `${leading}${reviewedMessages[key]}${trailing}`;
    }
    const dynamic = translateDynamic(key);
    const result = dynamic !== key ? dynamic : messages[key] || key;
    if (result === key) return value;
    const leading = value.match(/^\s*/)?.[0] || '';
    const trailing = value.match(/\s*$/)?.[0] || '';
    return `${leading}${result}${trailing}`;
  };

  const isExcluded = (node) => {
    let element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    while (element) {
      if (excluded.has(element.tagName) || element.hasAttribute('data-no-translate')) return true;
      element = element.parentElement;
    }
    return false;
  };

  const localizeHref = (anchor) => {
    const raw = anchor.getAttribute('href');
    if (!raw || raw.startsWith('#') || raw.startsWith('/ru') || raw.startsWith('//')) return;
    let url;
    try {
      url = new URL(raw, location.origin);
    } catch {
      return;
    }
    if (url.origin !== location.origin || /\.[a-z0-9]{1,8}$/i.test(url.pathname)) return;
    const blockedRoots = new Set(['/api', '/locales', '/.well-known', '/mcp', '/checkout/api']);
    if ([...blockedRoots].some((root) => url.pathname === root || url.pathname.startsWith(`${root}/`))) return;
    url.pathname = url.pathname === '/' ? '/ru' : `/ru${url.pathname}`;
    anchor.setAttribute('href', `${url.pathname}${url.search}${url.hash}`);
  };

  const localizeElement = (element) => {
    if (isExcluded(element)) return;
    for (const attribute of ['placeholder', 'aria-label', 'title', 'alt']) {
      const value = element.getAttribute(attribute);
      if (value) {
        const localized = translate(value);
        if (localized !== value) element.setAttribute(attribute, localized);
      }
    }
    if (element instanceof HTMLAnchorElement && !element.hasAttribute('data-language-switch')) localizeHref(element);
  };

  const localizeTree = (root) => {
    if (root.nodeType === Node.TEXT_NODE) {
      if (!isExcluded(root)) {
        const value = root.nodeValue || '';
        const localized = translate(value);
        if (localized !== value) root.nodeValue = localized;
      }
      return;
    }
    if (!(root instanceof Element) && root !== document) return;
    if (root instanceof Element) localizeElement(root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (node.nodeType === Node.TEXT_NODE) {
        if (!isExcluded(node)) {
          const value = node.nodeValue || '';
          const localized = translate(value);
          if (localized !== value) node.nodeValue = localized;
        }
      } else if (node instanceof Element) {
        localizeElement(node);
      }
    }
  };

  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    const request = input instanceof Request ? input : null;
    let url;
    try {
      url = new URL(request ? request.url : String(input), location.href);
    } catch {
      return nativeFetch(input, init);
    }
    if (url.origin !== location.origin) return nativeFetch(input, init);
    const headers = new Headers(request?.headers || init.headers);
    headers.set('x-superii-locale', 'ru');
    if (request) return nativeFetch(new Request(request, { ...init, headers }));
    return nativeFetch(input, { ...init, headers });
  };

  fetch('/locales/ru.json?v=20260908-8', { credentials: 'same-origin' })
    .then((response) => {
      if (!response.ok) throw new Error('Russian catalogue unavailable');
      return response.json();
    })
    .then((catalogue) => {
      messages = catalogue.messages || {};
      reviewedMessages = catalogue.reviewedMessages || {};
      localizeTree(document);
      const observer = new MutationObserver((records) => {
        for (const record of records) {
          for (const node of record.addedNodes) localizeTree(node);
          if (record.type === 'characterData') localizeTree(record.target);
          if (record.type === 'attributes' && record.target instanceof Element) localizeElement(record.target);
        }
      });
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['placeholder', 'aria-label', 'title', 'alt', 'href'],
      });
    })
    .catch(() => {
      // Server-rendered Russian remains usable when this enhancement cannot load.
    });
})();

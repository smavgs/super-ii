(() => {
  if (document.documentElement.lang !== 'zh-CN') return;

  const excluded = new Set(['SCRIPT', 'STYLE', 'PRE', 'CODE', 'SAMP', 'KBD', 'TEXTAREA', 'TEMPLATE', 'SVG']);
  const blockedRoots = ['/api', '/locales', '/.well-known', '/mcp', '/a2a'];
  const localizableRoots = new Set([
    '', 'about', 'account', 'agents', 'bring-my-work', 'build', 'builders', 'chats', 'checkout',
    'collections', 'contact', 'datasets', 'docs', 'enterprise', 'fame', 'feed', 'frontier-ai',
    'highlights', 'join-team', 'legal', 'models', 'new', 'notebooks', 'organizations', 'papers',
    'people', 'posts', 'pricing', 'products', 'proposals', 'repositories', 'review', 'robot', 'security',
    'sign-in', 'sign-up', 'skills', 'social', 'spaces', 'status', 'system-state', 'tokenizer',
    'transparent', 'use', 'workspace',
  ]);
  let messages = {};
  let reviewedMessages = {};

  const normalize = (value) => value.replace(/\s+/g, ' ').trim();
  const exact = (value) => reviewedMessages[value] || messages[value] || value;
  const translateDynamic = (value) => {
    let match = value.match(/^About (.+)$/);
    if (match) return `关于${exact(match[1])}`;
    match = value.match(/^Close (.+) information$/);
    if (match) return `关闭${exact(match[1])}说明`;
    match = value.match(/^(.+) information$/);
    if (match) return `${exact(match[1])}说明`;
    match = value.match(/^(.+) · Super ii$/);
    if (match) return `${exact(match[1])} · Super ii`;
    match = value.match(/^(.+) transparency report$/);
    if (match) return `${match[1]} 透明度报告`;
    match = value.match(/^(.+): (\d+) of (\d+) transparency fields established at revision (.+)\.$/);
    if (match) return `${match[1]}：在版本 ${match[4]} 已确认 ${match[2]}/${match[3]} 个透明度字段。`;
    match = value.match(/^(\d+) evidence (?:field|fields) changed$/);
    if (match) return `有 ${match[1]} 个证据字段发生变化`;
    match = value.match(/^(\d+) of (\d+) complete$/);
    if (match) return `已完成 ${match[1]}/${match[2]} 项`;
    match = value.match(/^(\d+) selected$/);
    if (match) return `已选择 ${match[1]} 项`;
    match = value.match(/^([\d.,\s\u00a0]+) bytes$/);
    if (match) return `${match[1].trim()} 字节`;
    match = value.match(/^(\d+) verified models? ready\.$/);
    if (match) return `${match[1]} 个已验证模型可用。`;
    match = value.match(/^(\d+) verified models? found\.$/);
    if (match) return `找到 ${match[1]} 个已验证模型。`;
    match = value.match(/^Open (model|dataset|app)$/);
    if (match) return `打开${exact(match[1])}`;
    match = value.match(/^Results for [“"](.+)[”"]$/);
    if (match) return `“${match[1]}”的搜索结果`;
    match = value.match(/^Page (\d+) of (\d+)$/);
    if (match) return `第 ${match[1]} 页，共 ${match[2]} 页`;
    match = value.match(/^View (.+?)[’']s public profile$/);
    if (match) return `查看 ${match[1]} 的公开资料`;
    match = value.match(/^(.+?)[’']s interests$/);
    if (match) return `${match[1]} 的兴趣`;
    match = value.match(/^(.+?)[’']s public activity$/);
    if (match) return `${match[1]} 的公开动态`;
    match = value.match(/^See all promoted (models|datasets|apps)$/);
    if (match) return `查看所有推广${exact(match[1])}`;
    match = value.match(/^No active (models|datasets|apps) promotions yet\. Reviewed public work can reserve equal rotation here\.$/);
    if (match) return `目前还没有正在推广的${exact(match[1])}。通过审核的公开作品可以在此获得平等轮播机会。`;
    match = value.match(/^(\d+) (file|files|row|rows|builder|builders|repository|repositories|skill|skills|item|items|post|posts|reply|replies|place|places|comment|comments|vote|votes|download|downloads|cell|cells)$/);
    if (match) {
      const nouns = {
        file: '个文件', files: '个文件', row: '行', rows: '行', builder: '位创作者', builders: '位创作者',
        repository: '个仓库', repositories: '个仓库', skill: '项技能', skills: '项技能', item: '项', items: '项',
        post: '篇帖子', posts: '篇帖子', reply: '条回复', replies: '条回复', place: '个名额', places: '个名额',
        comment: '条评论', comments: '条评论', vote: '票', votes: '票', download: '次下载', downloads: '次下载',
        cell: '个单元格', cells: '个单元格',
      };
      return `${match[1]} ${nouns[match[2]]}`;
    }
    match = value.match(/^(\d+) (?:skill|skills)(?: in (.+))?$/);
    if (match) return `${match[1]} 项技能${match[2] ? `，分类：${exact(match[2])}` : ''}`;
    match = value.match(/^Verified (server|browser) result · ([\d.,\s\u00a0]+) tokens(?: · first ([\d.,\s\u00a0]+) shown; JSON contains all)?\.$/);
    if (match) return `已验证的${exact(match[1])}结果 · ${match[2].trim()} 个词元${match[3] ? ` · 当前显示前 ${match[3].trim()} 个；JSON 包含全部结果` : ''}。`;
    match = value.match(/^Sort (.+)$/);
    if (match) return `排序：${exact(match[1])}`;
    match = value.match(/^Open (.+) skill$/);
    if (match) return `打开技能“${match[1]}”`;
    match = value.match(/^Open (.+) organization$/);
    if (match) return `打开组织“${match[1]}”`;
    match = value.match(/^Open (.+)$/);
    if (match) return `打开“${match[1]}”`;
    match = value.match(/^Dataset preview: (.+)$/);
    if (match) return `数据集预览：${match[1]}`;
    match = value.match(/^PDF preview: (.+)$/);
    if (match) return `PDF 预览：${match[1]}`;
    match = value.match(/^Link to cell (\d+)$/);
    if (match) return `链接到单元格 ${match[1]}`;
    match = value.match(/^Outputs for cell (\d+)$/);
    if (match) return `单元格 ${match[1]} 的输出`;
    match = value.match(/^Static output from cell (\d+)$/);
    if (match) return `单元格 ${match[1]} 的静态输出`;
    match = value.match(/^Provenance relationships for (.+)$/);
    if (match) return `${match[1]} 的来源关系`;
    match = value.match(/^Disconnect @(.+)$/);
    if (match) return `断开 @${match[1]}`;
    match = value.match(/^Organization type for (.+)$/);
    if (match) return `${match[1]} 的组织类型`;
    match = value.match(/^Founding place #(\d+) is (.+)$/);
    if (match) return `创始名额 #${match[1]}：${exact(match[2])}`;
    match = value.match(/^(.+) · Founding Supporter #(\d+)$/);
    if (match) return `${match[1]} · 创始支持者 #${match[2]}`;
    match = value.match(/^(.+) checkout$/);
    if (match) return `${exact(match[1])}结账`;
    match = value.match(/^Edit (.+)$/);
    if (match) return `编辑 ${match[1]}`;
    match = value.match(/^Safe static notebook reader for (.+)\.$/);
    if (match) return `用于 ${match[1]} 的安全静态笔记本阅读器。`;
    match = value.match(/^No matching (.+)$/);
    if (match) return `没有匹配的${exact(match[1])}`;
    match = value.match(/^No (.+) match “(.+)”\. Only reviewed public releases are searchable\.$/);
    if (match) return `${exact(match[1])}中没有与“${match[2]}”匹配的内容。只有通过审核的公开版本可供搜索。`;
    match = value.match(/^(.+) instructions selected\.$/);
    if (match) return `已选择 ${exact(match[1])} 说明。`;
    match = value.match(/^Hashing (.+)… (\d+)%$/);
    if (match) return `正在计算 ${match[1]} 的哈希… ${match[2]}%`;
    match = value.match(/^Uploading (.+)… (\d+)%$/);
    if (match) return `正在上传 ${match[1]}… ${match[2]}%`;
    match = value.match(/^Scanning (.+) in quarantine…$/);
    if (match) return `正在隔离区扫描 ${match[1]}…`;
    match = value.match(/^Completed locally with (.+)\.$/);
    if (match) return `已使用 ${match[1]} 在本地完成。`;
    match = value.match(/^Completed offline · seed (.+)$/);
    if (match) return `已离线完成 · seed ${match[1]}`;
    match = value.match(/^Build ready · (\d+) files · locked image\.$/);
    if (match) return `构建已就绪 · ${match[1]} 个文件 · 镜像已锁定。`;
    match = value.match(/^Watching (.+)\.$/);
    if (match) return `正在关注${exact(match[1])}。`;
    match = value.match(/^(\d+) found · (\d+) ready now$/);
    if (match) return `找到 ${match[1]} 项 · 目前有 ${match[2]} 项就绪`;
    match = value.match(/^(model|dataset|space|app) · (\d+) files · (.+) · (.+)$/);
    if (match) return `${exact(match[1])} · ${match[2]} 个文件 · ${match[3]} · ${exact(match[4])}`;
    match = value.match(/^(\d+)\/(\d+) orders · \$(.+) of \$(.+) authorized · (.+) · expires (.+)$/);
    if (match) return `${match[1]}/${match[2]} 个订单 · 已授权 $${match[3]}/$${match[4]} · ${match[5]} · ${match[6]} 到期`;
    match = value.match(/^(\d+)\/(\d+) actions · (.+) · expires (.+)$/);
    if (match) return `${match[1]}/${match[2]} 次操作 · ${match[3]} · ${match[4]} 到期`;
    match = value.match(/^(.+) · (\d+)\/(\d+) slots used$/);
    if (match) return `${match[1]} · 已使用 ${match[2]}/${match[3]} 个名额`;
    match = value.match(/^Loading (.+) posts…$/);
    if (match) return `正在加载${exact(match[1])}帖子…`;
    match = value.match(/^(\d+) public (?:post|posts) shown\.$/);
    if (match) return `已显示 ${match[1]} 篇公开帖子。`;
    match = value.match(/^Pairing code ready for @(.+)\.$/);
    if (match) return `@${match[1]} 的配对码已就绪。`;
    match = value.match(/^(Pause|Resume|Revoke) in progress…$/);
    if (match) return `正在${exact(match[1])}…`;
    match = value.match(/^Agent (pause|resume|revoke) completed\.$/);
    if (match) return `智能体${exact(match[1])}操作已完成。`;
    match = value.match(/^(.+) created\. Create a pairing code in the next panel\.$/);
    if (match) return `${match[1]}已创建。请在下一个面板中创建配对码。`;
    match = value.match(/^(Follow|Like) saved\.$/);
    if (match) return `${exact(match[1])}已保存。`;
    match = value.match(/^Payment status: (.+)\.$/);
    if (match) return `付款状态：${exact(match[1])}。`;
    match = value.match(/^USDC · Ethereum · (\$[\d,.]+) total(?: for (\d+) seats)? · (30 days|12 months)$/);
    if (match) return `USDC · Ethereum · 总计 ${match[1]}${match[2] ? `，${match[2]} 个席位` : ''} · ${match[3] === '12 months' ? '12 个月' : '30 天'}`;
    match = value.match(/^(\d+) places available now\.$/);
    if (match) return `目前有 ${match[1]} 个名额。`;
    match = value.match(/^Request failed \((\d+)\)$/);
    if (match) return `请求失败（${match[1]}）`;
    return value;
  };

  const translate = (value) => {
    const key = normalize(value);
    if (!key) return value;
    const dynamic = translateDynamic(key);
    const result = reviewedMessages[key] || (dynamic !== key ? dynamic : messages[key] || key);
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
    if (!raw || raw.startsWith('#') || raw.startsWith('/zh-cn') || raw.startsWith('//')) return;
    let url;
    try { url = new URL(raw, location.origin); } catch { return; }
    if (url.origin !== location.origin || /\.[a-z0-9]{1,8}$/i.test(url.pathname)) return;
    if (blockedRoots.some((root) => url.pathname === root || url.pathname.startsWith(`${root}/`))) return;
    const root = url.pathname.split('/').filter(Boolean)[0] || '';
    if (!localizableRoots.has(root)) return;
    url.pathname = url.pathname === '/' ? '/zh-cn' : `/zh-cn${url.pathname}`;
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
      } else if (node instanceof Element) localizeElement(node);
    }
  };

  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    const request = input instanceof Request ? input : null;
    let url;
    try { url = new URL(request ? request.url : String(input), location.href); } catch { return nativeFetch(input, init); }
    if (url.origin !== location.origin) return nativeFetch(input, init);
    const headers = new Headers(request?.headers || init.headers);
    headers.set('x-superii-locale', 'zh-CN');
    if (request) return nativeFetch(new Request(request, { ...init, headers }));
    return nativeFetch(input, { ...init, headers });
  };

  fetch('/locales/zh-cn.json?v=20261009-1', { credentials: 'same-origin' })
    .then((response) => {
      if (!response.ok) throw new Error('Simplified Chinese catalogue unavailable');
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
      // Server-rendered Chinese remains usable when this enhancement cannot load.
    });
})();

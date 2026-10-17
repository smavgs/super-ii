// Interface copy only; user content and connector configurations are preserved.
const messages: Record<string, [string, string]> = {
  'Workspace tools': ['Инструменты рабочего пространства', '工作区工具'],
  'Company and product': ['Компания и продукт', '公司与产品'],
  'Models, datasets and apps': ['Модели, наборы данных и приложения', '模型、数据集和应用'],
  'Add your files, shape your page and publish when it is ready.': ['Добавьте файлы, оформите страницу и опубликуйте, когда будете готовы.', '添加文件，完善页面，准备好后再发布。'],
  'Other ways to start': ['Другие способы начать', '其他开始方式'],
  'Super ii Bridge': ['Super ii Bridge', 'Super ii Bridge'],
  'Bring models, datasets and compatible apps. Your source account and files stay where they are.': ['Перенесите модели, наборы данных и совместимые приложения. Исходный аккаунт и файлы останутся на месте.', '带来模型、数据集和兼容的应用。源账号和文件仍保留在原处。'],
  'Check a source before importing': ['Проверить источник перед импортом', '导入前检查来源'],
  'My products': ['Мои продукты', '我的产品'],
  'Connect your agent, choose its access and keep control of its actions.': ['Подключите агента, выберите права доступа и управляйте его действиями.', '连接智能体，选择访问权限，并掌控其操作。'],
  'Choose your agent': ['Выберите агента', '选择您的智能体'],
  'Public reading needs no account. Work and Social access require your approval.': ['Для чтения публичных данных аккаунт не нужен. Доступ к Work и Social требует вашего одобрения.', '读取公开内容无需账号。Work 和 Social 访问需要您的批准。'],
  'Access and permissions': ['Доступ и разрешения', '访问与权限'],
  'Public reading': ['Чтение публичных данных', '读取公开内容'],
  'Scoped access': ['Ограниченный доступ', '限定范围的访问'],
  'Separate budget': ['Отдельный бюджет', '独立预算'],
  'Choose the products, budget and expiry before your agent can place an order.': ['Выберите продукты, бюджет и срок действия, прежде чем агент сможет оформить заказ.', '在智能体能够下单之前，先选择产品、预算和有效期。'],
  'Read the commerce contract': ['Открыть контракт Commerce', '查看商务协议'],
  'Public agents': ['Публичные агенты', '公开智能体'],
  'Protocols and documentation': ['Протоколы и документация', '协议与文档'],
  'Connector registry': ['Реестр подключений', '连接器注册表'],
  'Current setup status and exact client configurations': ['Текущий статус настройки и точные конфигурации клиентов', '当前设置状态与准确的客户端配置'],
};
export const journeyRussian = Object.fromEntries(Object.entries(messages).map(([key, values]) => [key, values[0]]));
export const journeyChinese = Object.fromEntries(Object.entries(messages).map(([key, values]) => [key, values[1]]));

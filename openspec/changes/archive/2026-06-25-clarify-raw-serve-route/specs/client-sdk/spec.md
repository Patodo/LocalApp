## MODIFIED Requirements

### Requirement: basePath 自动检测

SDK 的 `createClient()` 函数 SHALL 自动检测应用 API basePath。检测顺序 SHALL 为：优先读取平台 Shell 注入的 native app resource base（如 `[data-localapp-app-resource-base]` 或等价元数据），当该 base 指向 `/serve/{userId}/{name}/` 时，basePath SHALL 解析为 `/serve/{userId}/{name}/api`；其次兼容应用直接运行在 raw route `/serve/{userId}/{name}/` 下的 pathname 检测；最后回退为 `/api`。`/api/me` 路径 SHALL 固定使用 `/api/me`，不依赖 basePath。

#### Scenario: native Shell 内自动检测
- **WHEN** 应用在正式 Shell route `/alice/my-app/` 中运行
- **AND** 页面注入的 native app resource base 为 `/serve/alice/my-app/`
- **THEN** `createClient()` 自动设置 basePath 为 `/serve/alice/my-app/api`

#### Scenario: raw route 兼容检测
- **WHEN** 应用直接运行在 raw route，`window.location.pathname` 为 `/serve/alice/my-app/index.html`
- **THEN** `createClient()` 自动设置 basePath 为 `/serve/alice/my-app/api`
- **AND** 该场景 SHALL 被视为 raw route 兼容，不代表默认用户验收入口

#### Scenario: 根路径访问
- **WHEN** 应用直接在根路径运行，`window.location.pathname` 为 `/`
- **THEN** `createClient()` 设置 basePath 为 `/api`

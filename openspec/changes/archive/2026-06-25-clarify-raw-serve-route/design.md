## Context

LocalApp 当前已经采用 native PlatformShell 架构：用户访问 `/{owner}/{app}` 时，server 返回平台 Shell，Shell 再从 raw app resource base 加载上传应用的 `index.html`、JS、CSS，并在同页 app container 中挂载应用。

`/serve/{owner}/{app}/` 在这个架构下仍然必要，但它的职责已经变化为内部 raw app resource/API base。它不再代表正式用户页面，也不应该作为应用功能验收入口。现有问题在于一些模板文档、agent skill、测试指引和 SDK 场景仍沿用旧表述，导致应用侧和验证 agent 继续访问 `/serve`，从而绕过平台 Shell。

## Goals / Non-Goals

**Goals:**

- 统一正式用户访问和应用验收入口为 `/{owner}/{app}`。
- 保留 `/serve/{owner}/{app}/` 作为内部 raw app resource/API base，避免破坏 PlatformShell 加载机制和现有资源/API 兼容性。
- 更新规格、文档、模板、skill、CLI 输出和测试命名，使 `/serve` 不再被描述为预览入口。
- 明确 SDK 在 native Shell 中应优先使用平台注入的 resource base，而不是依赖当前页面路径是 `/serve`。
- 让未来 agent 或应用开发者从初始化文档中自然走正式 Shell 验证路径。

**Non-Goals:**

- 不删除 `/serve` 路由。
- 不改变应用静态资源、SPA fallback、应用级 API 的 URL 兼容性。
- 不引入新的前端承载方式或 iframe 回退。
- 不把应用开发者本地 `localapp dev` 的 DevShell 升级为生产 Shell。

## Decisions

### Decision 1: `/serve` 保留为 raw app resource/API route

`/serve/{owner}/{app}/` SHALL 继续返回上传应用的原始 `index.html`、assets、SPA fallback 和 `/api/*`。PlatformShell 通过 server 注入的 `data-localapp-app-resource-base` 或等价配置读取该 base。

备选方案是删除或隐藏 `/serve`，让资源和 API 都挂到 `/{owner}/{app}` 下。该方案会让 Shell route 与 raw asset/API route 混在一起，增加路由优先级、SPA fallback 和平台页面渲染的复杂度，也会破坏已上传应用的资源 URL 兼容性，因此不采用。

### Decision 2: `/{owner}/{app}` 是唯一默认验收入口

所有用户体验验证、应用协作 skill、E2E 指引和 CLI 默认输出 SHALL 指向 `/{owner}/{app}`。只有当测试目标是资源服务、SPA fallback、SDK basePath raw 兼容或应用级 API 基座时，才直接访问 `/serve`。

备选方案是同时展示两个入口并由开发者选择。该方案会继续放大歧义，agent 很容易选择看似更“直接”的 `/serve`，因此默认输出必须偏向正式 Shell URL。

### Decision 3: SDK basePath 优先读取 Shell 注入元数据

在正式 native Shell 中，浏览器地址是 `/{owner}/{app}`，但应用 API 仍位于 `/serve/{owner}/{app}/api`。SDK 的自动检测 SHALL 优先读取平台注入的 app resource base，再从 raw `/serve` pathname 兼容检测，最后回退 `/api`。

备选方案是让应用显式配置 API basePath。该方案会把平台内部路由泄漏给应用开发者，并降低模板易用性，因此仅保留为可选覆盖，不作为默认路径。

### Decision 4: 测试按职责分层

Shell route 测试负责验证正式页面、平台导航栏、native app mount container、resource base 注入和用户体验。Raw route 测试只负责验证静态资源、SPA fallback、MIME/CSP 和应用级 API。文档检查测试 SHALL 防止 skill/模板重新把 `/serve` 写成默认验收入口。

## Risks / Trade-offs

- 旧文档或第三方 agent 仍可能直接访问 `/serve` → 通过 init-repo、项目 skill、E2E 指引和 CLI 输出统一改口，并增加字符串/场景测试拦截回退。
- `/serve` 继续公开可能被误认为可用页面 → 在命名、注释和输出中统一称为 raw/internal resource route；功能上保持兼容但不宣传。
- Shell route 和 raw route 双路径增加测试数量 → 通过分层测试降低耦合：Shell 只测用户契约，raw 只测资源/API 契约。
- Next dev 的平台 Shell 预览路径可能继续被误解为应用开发者预览入口 → 文档明确它是平台开发者热更新 Shell 组件的路径，应用开发者本地仍使用 `localapp dev` DevShell。

## Migration Plan

1. 先新增失败测试，覆盖 CLI/文档/skill 不得把 `/serve` 作为默认验收入口，以及 SDK 在 Shell 注入 resource base 时的 basePath。
2. 更新 CLI 输出、init-repo 文档、应用协作 skill 和 E2E 指引。
3. 更新 server/web/sdk 测试命名和断言，区分 Shell route 与 raw route。
4. 保留 `/serve` 行为不变，避免运行时破坏。
5. 归档后同步主规格，使未来变更以 Shell route 为用户契约。

回滚策略：如更新后发现下游依赖 `/serve` 文档或 CLI 输出，可恢复 raw URL 的辅助展示，但必须保留“内部资源/API 基座”的标识，不恢复为默认验收入口。

## Open Questions

无阻塞问题。实施时可根据现有 CLI 输出结构决定是否完全隐藏 raw URL，或仅在调试字段中标注为 internal raw URL。

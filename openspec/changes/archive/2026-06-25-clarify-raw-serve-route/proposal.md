## Why

LocalApp 已经从 iframe/裸应用预览迁移到 native PlatformShell 架构。正式应用访问、用户验收和平台能力验证都应该发生在 `/{owner}/{app}`，由平台 Shell 承载应用并提供导航栏、身份、Issue、AI 侧栏、收藏、通知等能力。

但当前部分文档、测试指引、应用协作 skill、模板说明和 SDK 场景仍把 `/serve/{owner}/{app}/` 当作应用预览或验收入口。这会让应用侧绕过正式平台 Shell 进行验证，误判应用在生产形态下的行为，也会继续传播“访问 serve 才是应用页面”的旧模型。

同时 `/serve/{owner}/{app}/` 仍然是必要的内部基础设施：PlatformShell 需要从这里读取上传应用的原始 `index.html`、静态资源和应用级 API。问题不是删除 `/serve`，而是明确它的角色：它是 raw app resource/API base，不是用户入口。

## What Changes

- 将正式应用入口和验收入口统一定义为 `/{owner}/{app}`。
- 将 `/serve/{owner}/{app}/` 明确定义为内部 raw app resource/API route，仅用于平台 Shell 加载应用资源、SDK/API 调用和底层调试。
- 保持 `/serve` 兼容可用，不做破坏性删除；但文档、CLI 输出、测试和 skill 不得再把它称为预览入口或默认验收入口。
- 更新 SDK/basePath 规格：native Shell 中优先使用平台注入的 app resource base 解析应用 API，`/serve` 路径只作为 raw route 兼容场景。
- 更新 init-repo、应用协作 skill、E2E 指引和 CLI 输出语义，使应用开发者和验证 agent 默认访问 `/{owner}/{app}`。
- 更新测试边界：用户体验测试覆盖 Shell route；raw route 测试仅覆盖资源服务、SPA fallback 和应用级 API 基础设施。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `page-serving`：澄清正式应用入口、raw `/serve` route 的内部角色、重定向和 SPA fallback 的适用边界。
- `platform-shell`：明确 PlatformShell 是正式用户入口的承载者，raw resource base 仅为内部加载机制。
- `native-app-runtime`：明确 native app 运行和验收不应以 `/serve` 页面为准，必须在 PlatformShell 容器内验证。
- `client-sdk`：明确 basePath 检测优先读取 Shell 注入的 resource base，`/serve` pathname 检测仅用于 raw route 兼容。
- `init-template`：更新模板文档、skill 和测试指引，避免把 `/serve` 作为应用功能验证入口。

## Impact

- 影响 `packages/server/src/routes/serve.ts` 相关测试和路由命名说明，但不要求删除 `/serve`。
- 影响 `packages/web/components/shell/` 的资源加载契约测试和 Next dev 平台预览说明。
- 影响 `packages/sdk-core` 的 basePath 检测测试用例命名和场景描述。
- 影响 `init-repo/CLAUDE.md`、模板内 `.Codex/skills`、runtime 文档和示例验证步骤。
- 影响 `.agents/skills/localapp-app-loop` 以及主项目 E2E/agent 测试指南。
- 影响 CLI 上传或信息展示时暴露的 URL 语义：默认展示正式 Shell URL；raw URL 如需展示必须标注为内部资源/API 基座。

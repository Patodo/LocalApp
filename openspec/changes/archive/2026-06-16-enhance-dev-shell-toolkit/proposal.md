## Why

开发环境已经通过 mini-server 与生产应用数据隔离，但 DevShell 仍只提供 AI 面板和工具列表，开发者无法快速从不同用户、不同日期、不同数据状态验证业务应用行为。

现在可以把 DevShell 扩展为 dev-only 控制台，让身份、时间、数据状态和本地 API 行为都可观察、可切换、可复现，尤其服务于 `recordAccess`、`defaultFrom`、`transitions` 等业务建模能力。

## What Changes

- 新增 DevShell 开发工具集：身份切换、时间切换、本地数据 reset/snapshot、业务规则可视化、请求诊断入口。
- 新增 mini-server dev context API，由 mini-server 统一维护当前开发用户、开发时间和诊断状态。
- mini-server 的 `/api/me`、CRUD visitor、`defaultFrom`、`recordAccess`、transition 写入中的 `currentUser.*` 和 `now` SHALL 读取同一份 dev context。
- mini-server 补齐本地 transition 端点，使 dev 模式下 `useTransitions()` 与生产环境一致。
- DevShell 与应用运行时可读取 dev context，并在 context 变化后触发应用数据刷新或页面重载，避免界面停留在旧身份/旧时间。
- 开发工具只在 `localapp dev` 注入的 DevShell 中可用，生产构建和上传产物不包含这些工具或 dev context 入口。
- 不引入破坏性变更；既有未使用 DevShell 工具的应用继续按默认 `dev-user` 和真实时间运行。

## Capabilities

### New Capabilities
- `dev-shell-toolkit`: 定义 DevShell 开发工具集、dev context UI、身份/时间/数据/诊断工具，以及生产隔离边界。

### Modified Capabilities
- `local-mini-server`: mini-server 从固定 mock 用户升级为可变 dev context，并补齐 transition API、本地数据 reset/snapshot 和诊断能力。
- `dev-config-context`: `dev-config.json` 和 dev proxy SHALL 继续承载 mini-server 端口，并为 DevShell 与 mini-server 共享开发上下文入口提供稳定配置。
- `dev-shell-injection`: DevShell 仍通过 vite-plugin 虚拟模块注入，但注入后的 shell SHALL 提供开发工具集，并保持生产构建隔离。

## Impact

- `init-repo/runtime/dev-shell.tsx`: 新增开发工具控制台 UI、context 同步、数据刷新/重载策略、请求/工具诊断展示。
- `init-repo/runtime/mini-server.mjs`: 新增 `/api/dev/context`、本地 transition 端点、reset/snapshot、请求日志、统一 visitor/now 解析。
- `init-repo/runtime/vite-plugin.mjs`: 确认 dev context API 只代理到 mini-server，生产构建不注入 DevShell。
- `packages/server-core`: 可能需要让 transition 写入支持可注入 `now`，以便 mini-server 与生产 server 共享核心逻辑但使用不同时间源。
- `packages/sdk-react` / `packages/sdk-core`: 可能新增 dev-only context 读取或 refresh 辅助；不得影响生产 bundle 的默认业务 API。
- `init-repo/tests`、`packages/*/tests`: 增加 mini-server、DevShell、vite-plugin 和 transition 一致性回归测试。
- OpenSpec specs: 新增 `dev-shell-toolkit`，并修改 `local-mini-server`、`dev-config-context`、`dev-shell-injection`。

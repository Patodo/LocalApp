## Why

当前 DevShell 顶栏与生产平台 nav-shell 的结构差异较大，开发者在本地看到的页面外壳无法准确预期上线后的应用外壳。结果是应用可能为了弥补开发态缺失的导航信号而自行实现应用内导航栏，发布后与平台 Shell 重复。

本变更将 DevShell 调整为以生产 nav-shell 为基准，仅通过最左侧 `DEV` 按钮承载开发态专属功能，使本地开发预览更接近上线 UI，同时保留开发调试入口。

## What Changes

- 将 DevShell 顶栏中的 `开发` 文案改为 `DEV`。
- 将 `DEV` 放在顶栏最左侧，并改造成可点击按钮。
- 点击 `DEV` 展开下拉框，下拉框中包含现有的工具列表入口和开发工具入口。
- DevShell 顶栏其余布局、视觉层级和平台功能占位对齐生产 nav-shell。
- DevShell 顶栏应展示应用外壳中的关键平台信号，例如应用名称、右侧用户状态或未登录状态，使开发者能预期发布后的外壳 UI。
- Dev-only 的工具列表、开发工具、AI 调试面板等入口不得继续平铺在顶栏中挤占生产 nav-shell 的位置。
- 生产构建继续不包含 DevShell、`DEV` 按钮、开发工具、`/api/dev/*` 标识或 dev 事件。
- 不在本变更中开放应用编辑 nav-shell 的能力；该方向仅作为后续平台能力预留。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- `dev-shell-injection`: DevShell 注入后的顶栏应对齐生产 nav-shell，仅通过最左侧 `DEV` 按钮暴露开发态差异。
- `dev-shell-toolkit`: 工具列表和开发工具入口应收纳到 `DEV` 下拉框中，并保持现有工具面板能力。
- `init-template`: 初始化模板和 runtime 同步应交付新的 DevShell 顶栏结构，现有项目执行 `localapp sync` 后获得该体验。

## Impact

- `init-repo/runtime/dev-shell.tsx`: 顶栏布局、DEV 下拉、工具入口组织、用户状态展示。
- `init-repo/runtime/styles/preset.css`: 如有必要补充 DevShell 下拉和 nav 对齐所需的稳定 token。
- `init-repo/tests/dev-shell-template.test.ts`: 增加 DEV 下拉、nav 对齐、生产隔离和无重复入口的静态/样式测试。
- `init-repo/tests/vite-plugin.test.ts`: 确认 dev 注入仍可用且 build 不包含 dev-only 标识。
- `packages/cli` 内置模板打包：确保 `localapp sync` 更新 runtime 文件。

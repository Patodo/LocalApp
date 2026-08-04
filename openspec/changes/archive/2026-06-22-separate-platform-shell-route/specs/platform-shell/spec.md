## ADDED Requirements

### Requirement: PlatformShell 模板路由独立于裸应用资源路径

`packages/web` SHALL 使用独立的 PlatformShell 模板路由导出生产 shell HTML。该模板路由 SHALL NOT 使用 `/serve/[userId]/[name]`，因为 `/serve` 在平台中保留给上传应用的裸资源服务。推荐模板路由为 `/platform-shell/[userId]/[name]`。

#### Scenario: 静态导出生成独立 shell 模板
- **WHEN** 在 `packages/web` 中运行生产构建
- **THEN** 静态导出目录 SHALL 包含 `platform-shell/placeholder/placeholder.html`
- **AND** 该 HTML SHALL 渲染 `PlatformShell`
- **AND** server 正式入口 SHALL NOT 依赖 `serve/placeholder/placeholder.html` 作为 shell 模板

#### Scenario: 模板路径不改变正式入口
- **WHEN** 用户访问 `/{userId}/{name}`
- **THEN** 服务端 SHALL 返回 PlatformShell HTML
- **AND** 浏览器地址 SHALL 保持 `/{userId}/{name}`
- **AND** 用户 SHALL NOT 需要访问 `/platform-shell/{userId}/{name}` 才能使用正式应用

### Requirement: 平台开发者可在 Next dev 中预览 PlatformShell

`packages/web` SHALL 提供平台开发者专用的 Next dev shell 预览路径。该路径 SHALL 渲染与生产正式入口相同的 `PlatformShell` 组件，并支持 Next dev 热更新。

#### Scenario: Next dev shell 预览可访问
- **WHEN** `packages/web` 的 Next dev server 运行在 3001 端口，server 运行在 3000 端口
- **THEN** 平台开发者访问 `http://localhost:3001/platform-shell/{userId}/{name}`
- **THEN** 页面 SHALL 渲染 PlatformShell 导航栏和 native app mount container
- **AND** 页面 SHALL NOT 进入 `/serve` 尾斜杠重定向循环

#### Scenario: 修改 shell 组件触发热更新
- **WHEN** 平台开发者修改 `packages/web/components/shell/` 下的 shell 组件
- **THEN** `http://localhost:3001/platform-shell/{userId}/{name}` SHALL 通过 Next dev 展示更新后的 shell
- **AND** 不要求先运行 `packages/web` 的生产构建

### Requirement: 应用开发 DevShell 保持生产隔离

应用开发者的 DevShell SHALL 继续只存在于 `localapp dev` / Vite dev 模式。PlatformShell 模板路由迁移 SHALL NOT 将 DevShell 的 `DEV` 按钮、开发工具、`/api/dev/*` 或 dev event 引入 `packages/web` 的生产 shell。

#### Scenario: 生产 shell 不包含 DevShell 标识
- **WHEN** 在 `packages/web` 中运行生产构建
- **THEN** PlatformShell 导出的 HTML 和客户端 bundle SHALL NOT 包含 `Dev Toolkit`
- **AND** SHALL NOT 包含 `/api/dev/context`
- **AND** SHALL NOT 包含 `localapp:dev-context-changed`

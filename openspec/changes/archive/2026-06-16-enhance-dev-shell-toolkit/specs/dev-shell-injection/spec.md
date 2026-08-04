## ADDED Requirements

### Requirement: 注入的 DevShell 包含开发工具集且保持生产隔离
通过 vite-plugin 虚拟模块注入的 DevShell SHALL 包含开发工具集入口。该工具集 SHALL 只在 `command === "serve"` 时可达，`command === "build"` 时不得进入构建图。

#### Scenario: dev 注入工具集
- **WHEN** 用户执行 `localapp dev`
- **THEN** vite-plugin SHALL 注入包含 DevShell 工具集的虚拟模块
- **AND** 页面 SHALL 显示开发工具入口

#### Scenario: build 不注入工具集
- **WHEN** 用户执行 `npm run build`
- **THEN** vite-plugin SHALL 不注入 DevShell 虚拟模块
- **AND** 生产 bundle SHALL 不包含开发工具集代码

### Requirement: DevShell 不复制生产 nav-shell 用户入口
DevShell 开发工具集 SHALL 保持调试工具层定位，不得复制生产 nav-shell 的头像、登录、收藏、通知、Issue 等用户入口。模拟身份切换 SHALL 明确标注为本地开发上下文，而非真实平台登录。

#### Scenario: 显示模拟身份而非真实登录入口
- **WHEN** DevShell 显示当前模拟用户
- **THEN** UI SHALL 标注该用户来自 dev context
- **AND** 不得显示生产登录/登出按钮

#### Scenario: 生产 nav-shell 功能仍归生产 shell
- **WHEN** 应用在生产环境被访问
- **THEN** 头像、收藏、通知、Issue 等入口 SHALL 仍由平台 shell 提供
- **AND** DevShell 工具集 SHALL 不参与生产页面渲染

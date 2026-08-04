## ADDED Requirements

### Requirement: localapp dev 启动 native dev runtime
`localapp dev` SHALL 启动 mini-server 和 Vite，并使浏览器页面运行 native DevShell + App。dev runtime SHALL 不依赖 iframe。

#### Scenario: dev 页面为 native shell
- **WHEN** 用户执行 `localapp dev`
- **THEN** Vite 页面 SHALL 渲染 DevShell 和 App 的同页结构
- **AND** 页面 SHALL NOT 使用 iframe 承载 App

### Requirement: dev config 写入 native runtime 所需信息
`localapp dev` SHALL 写入 dev-config，包括 userId、pageName、serverUrl、miniServerPort 和 native runtime 所需的 shell 上下文。

#### Scenario: dev-config 包含 mini-server 端口
- **WHEN** `localapp dev` 成功启动
- **THEN** `.localapp/dev-config.json` SHALL 包含 `miniServerPort`
- **AND** Vite plugin SHALL 使用该端口分流 `/api/*`

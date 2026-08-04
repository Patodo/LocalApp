## ADDED Requirements

### Requirement: 生产页面 native 渲染
`GET /serve/{userId}/{name}` 或平台定义的生产应用入口 SHALL 返回 native 平台 shell 页面。该页面 SHALL 加载最新版本应用资源并在 app container 中挂载应用。

#### Scenario: 访问已存在应用
- **WHEN** 用户访问已存在应用的生产入口
- **THEN** 服务端 SHALL 返回平台 shell HTML 或对应 shell route
- **AND** 响应 SHALL 指向最新版本应用资源
- **AND** 响应 SHALL NOT 包含应用 iframe wrapper

### Requirement: 应用静态资源服务保留
服务端 SHALL 继续从最新版本目录提供应用 JS、CSS、图片和其他静态资源，并保持 SPA fallback 与明确资源 404 规则。

#### Scenario: 请求应用资源
- **WHEN** 浏览器请求最新版本的应用 asset
- **THEN** 服务端 SHALL 返回对应文件内容和正确 MIME 类型

#### Scenario: 缺失资源不 fallback
- **WHEN** 请求带扩展名但不存在的资源
- **THEN** 服务端 SHALL 返回 HTTP 404

## REMOVED Requirements

### Requirement: 页面 native app 包装
**Reason**: 应用不再通过 iframe 包装运行。
**Migration**: 生产入口改为 native shell + app mount。

### Requirement: 页面 native app 包装端到端验证
**Reason**: iframe wrapper 测试不再符合目标架构。
**Migration**: 端到端测试 SHALL 验证页面不包含 iframe，并验证 native app mount 成功渲染。

### Requirement: 页面服务根据 shell 配置调整渲染
**Reason**: `shell.navbar=false` 的无壳 iframe 入口与 native 一体化目标冲突。
**Migration**: 平台 shell 始终存在；如未来需要无壳嵌入，应作为独立新能力设计。

# desktop-local-runtime Specification

## Purpose
TBD - created by syncing change add-desktop-local-runtime. Update Purpose when the capability is finalized.

## Requirements

### Requirement: Desktop 管理单进程多应用 Runtime

LocalApp Desktop SHALL 使用内置 Node sidecar 启动并监管一个 Local Runtime 进程。所有已安装应用 SHALL 由该进程承载，且 SHALL NOT 为每个已安装应用启动 Vite 或独立 Node 服务。

#### Scenario: 多个应用共享一个 Runtime
- **WHEN** 用户安装并打开至少两个本地应用
- **THEN** Desktop SHALL 只运行一个 Local Runtime 进程
- **AND** 两个应用 SHALL 可同时访问且拥有独立数据

#### Scenario: Desktop 重启恢复应用库
- **WHEN** Desktop 和 Local Runtime 退出后再次启动
- **THEN** Desktop SHALL 从持久注册表恢复已安装应用
- **AND** 用户无需远端登录即可再次打开应用

### Requirement: 每应用独立回环 Origin 和上下文

Local Runtime SHALL 只监听 loopback，并通过经过验证的 `<app-id>.localhost` Host 为每个应用提供独立 Origin。静态资源、SDK API、SQLite、文件、缓存和维护操作 SHALL 使用显式应用上下文隔离。

#### Scenario: 应用数据和文件不串用
- **WHEN** 两个应用使用相同表名、记录 ID 和文件名并发读写
- **THEN** 每个应用 SHALL 只读取和修改自己的数据库与文件目录
- **AND** 对一个应用执行维护 SHALL NOT 关闭或重置另一个应用

#### Scenario: 非法 Host 被拒绝
- **WHEN** 请求使用未知应用、非法 app ID、非 loopback Host 或不匹配的 Origin
- **THEN** Local Runtime SHALL 拒绝请求
- **AND** SHALL NOT 泄露已安装应用信息

### Requirement: 本地会话和单用户身份

Desktop SHALL 使用一次性短时效 ticket 打开本地应用；Local Runtime SHALL 将有效 ticket 换为 HttpOnly、SameSite=Strict 的应用会话并立即清除 URL 中的 ticket。本地应用 SHALL 获得稳定单用户身份且不显示远端登录要求。

#### Scenario: 打开本地应用
- **WHEN** 用户在 Desktop 应用库点击打开
- **THEN** 默认浏览器 SHALL 打开该应用的 Local Platform Shell
- **AND** ticket SHALL 只能消费一次
- **AND** 应用 SHALL 以稳定本地用户身份运行

#### Scenario: 拒绝重放或跨应用会话
- **WHEN** ticket 被重复使用或应用 A 的会话用于应用 B
- **THEN** Local Runtime SHALL 拒绝访问
- **AND** SHALL NOT 创建新的有效会话

### Requirement: Local Runtime 生命周期与故障隔离

Desktop SHALL 展示 Runtime 和每个应用的可操作状态。单应用加载或 migration 失败 SHALL 只隔离该应用；Runtime 意外退出时 Desktop SHALL 限速重启并保留注册与数据。明确退出 Desktop SHALL 优雅停止 Runtime，关闭窗口到托盘 SHALL 保持其运行。

#### Scenario: 单应用故障不阻断其他应用
- **WHEN** 一个已安装应用无法加载或 migration 失败
- **THEN** Desktop SHALL 将该应用标记为不可用并展示原因
- **AND** 其他应用 SHALL 继续运行

#### Scenario: 退出与托盘行为
- **WHEN** 用户关闭主窗口到托盘
- **THEN** Local Runtime SHALL 保持运行
- **AND** 当用户明确退出 Desktop 时 SHALL 停止 Runtime 及其进程树

### Requirement: Desktop 本地应用管理

Desktop SHALL 提供本地应用库，允许用户安装 `.localapp`、查看版本与状态、打开、升级和卸载应用。应用代码 SHALL 在系统默认浏览器运行，不得在拥有 Tauri 原生权限的 WebView 中运行。

#### Scenario: 无账号首次使用
- **WHEN** 用户首次启动 Desktop 且未配置任何 LocalApp Server
- **THEN** 用户 SHALL 能安装和运行本地应用
- **AND** 应用管理界面 SHALL NOT 以远端登录作为前置条件

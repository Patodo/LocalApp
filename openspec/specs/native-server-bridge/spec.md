# native-server-bridge Specification

## Purpose

定义可选的无窗口 Tauri 分发如何仅作为 canonical Server 的系统托盘、进程和 Scheme 桥，而不成为第二套客户端后端。

## Requirements

### Requirement: 原生分发启动完全相同的 Server artifact

桌面分发 SHALL 捆绑并启动与独立 Node 分发相同、经过摘要校验的 `localapp-server` artifact 及其 Node 运行时。它 SHALL NOT 内嵌另一套应用托管、认证、权限、上传、同步或管理后端。

#### Scenario: 启动托盘分发

- **WHEN** 用户启动 LocalApp 原生分发
- **THEN** bridge SHALL 启动捆绑的 canonical Server 并等待其 readiness
- **AND** Web 管理主页和应用 SHALL 由该 Server 提供

### Requirement: 原生层只有托盘和生命周期职责

原生层 SHALL 无窗口运行，并且产品级职责只包括打开 Server 主页、退出本地 Server、监督 Server 进程树和转发已注册的 `localapp://` 激活票据。应用业务逻辑、Device Action 信任/执行、数据库和权限 SHALL 由 Server 实现。

#### Scenario: 托盘菜单

- **WHEN** 用户打开托盘菜单
- **THEN** SHALL 提供“打开主页”和“退出本地服务”操作
- **AND** SHALL NOT 提供独立的原生管理界面或应用运行时

#### Scenario: 退出本地服务

- **WHEN** 用户选择退出
- **THEN** bridge SHALL 优雅终止并等待 Server 进程树
- **AND** SHALL 保留 Server 数据供下次启动使用

### Requirement: Scheme 桥不承载动作内容

Scheme handler SHALL 解析版本化激活票据并使用仅进程持有的 control token 将其提交到本机回环 Server。bridge SHALL NOT 获取动作脚本、授予信任、准备依赖或执行动作。

#### Scenario: 收到 Device Action Scheme

- **WHEN** 操作系统把 `localapp://action/...` 交给 bridge
- **THEN** bridge SHALL 把票据转发到本机 Server control 端点
- **AND** 后续确认、执行和结果 SHALL 在 Server Web/Server 内完成

### Requirement: Scheme 解析器只接受规范票据

bridge SHALL 对 `localapp://action/<canonical-action-id>` 执行严格解析，只接受恰好一个规范 action id 路径段，以及各出现一次的 `origin`、`nonce`、`protocolVersion` 字段。解析器 SHALL 拒绝未知或重复字段、userinfo、端口、fragment、非规范编码、过长或含控制字符的 URL，以及 `script`、`command`、`dependencies`、凭据、文件路径等任何可执行或敏感字段。嵌套来源 origin SHALL 同样拒绝 userinfo、路径、query 和 fragment。

#### Scenario: 恶意 Scheme 夹带动作内容

- **WHEN** Scheme 包含未知/重复字段、userinfo、fragment、额外路径段或脚本/命令/路径字段
- **THEN** bridge SHALL 静默拒绝该激活
- **AND** SHALL NOT 启动 claim、打开 URL 或执行任何动作

### Requirement: bridge 只打开精确的本地确认 URL

bridge SHALL 仅接受与本次 Server readiness 返回的 origin 完全相同、路径精确为 `/my/device-actions/`、且唯一 `requestId` query 等于 control 响应 request id 的确认 URL。它 SHALL 拒绝 userinfo、fragment、额外路径段、未知/重复 query、跨 origin 和降级 URL；bridge SHALL NOT 打开来源 Server 返回的任意 URL。

#### Scenario: control 响应返回替代确认地址

- **WHEN** control 响应的确认 URL 使用不同 origin、相似路径、额外路径段、未知 query 或不匹配 request id
- **THEN** bridge SHALL 拒绝打开该 URL
- **AND** 动作仍由本地 Server 保持为可审计状态

### Requirement: 默认回环且 LAN 访问显式启用

Server 默认 SHALL 只监听 `127.0.0.1`。用户只有在 Server Web 设置中显式开启局域网访问后才可绑定 LAN；回环和 LAN 模式 SHALL 都使用完整多用户登录、session/API Key 和权限检查，不得存在“本地免认证”模式。

#### Scenario: 默认首次启动

- **WHEN** 用户没有开启 LAN 访问
- **THEN** Server SHALL 只接受本机回环连接
- **AND** Web 管理主页仍 SHALL 要求正常登录和权限

#### Scenario: 显式开启 LAN

- **WHEN** 管理员在 Web 设置中确认开启局域网访问
- **THEN** Server MAY 监听配置的 LAN 地址
- **AND** 所有用户、应用和管理接口 SHALL 保持同一认证与授权行为

# native-adapter Specification

## Purpose

定义 `localapp` npm 包内极小 native adapter 与同一 Node.js daemon 的边界。

## Requirements

### Requirement: adapter 不启动另一套运行时

adapter SHALL 只连接由 npm 包启动的当前用户 daemon。它 SHALL NOT 托管 Web、应用、
认证、权限、上传、同步或管理后端，也 SHALL NOT 提供窗口或系统菜单界面。

#### Scenario: npm 包启动本地服务

- **WHEN** 用户执行 `localapp server`
- **THEN** TypeScript CLI SHALL 注册并启动运行同一 Server 的当前用户 daemon
- **AND** Web 管理主页与应用 SHALL 由该 Server 提供

### Requirement: adapter 只有系统集成职责

adapter 的产品职责 SHALL 限于注册/转发 `localapp://`、显示系统通知、回传通知点击，
以及 Windows 所需的当前用户协议/AUMID 注册。生命周期与进程监督由 TypeScript daemon
负责。

#### Scenario: Scheme 激活

- **WHEN** 操作系统把 `localapp://action/...` 交给 adapter
- **THEN** adapter SHALL 使用固定 IPC 协议把完整 URL 转交 daemon
- **AND** 后续解析、确认、执行与审计 SHALL 在 daemon/Server 内完成

#### Scenario: 显示系统通知

- **WHEN** daemon 提交经过验证的通知 envelope
- **THEN** adapter SHALL 显示通知并把点击作为短期 ticket 返回 daemon
- **AND** SHALL NOT 保存来源 API Key 或自行读取应用数据

### Requirement: Scheme 不承载动作内容

daemon SHALL 严格解析版本化激活票据并拒绝未知/重复字段、userinfo、fragment、非规范
编码，以及 `script`、`command`、`dependencies`、凭据和文件路径等可执行或敏感字段。

#### Scenario: 恶意 Scheme 夹带内容

- **WHEN** Scheme 包含脚本、命令、路径、凭据或不规范字段
- **THEN** 激活 SHALL 被拒绝且不 claim、不打开 URL、不执行动作

### Requirement: 默认回环且 LAN 显式启用

daemon 中的 Server 默认 SHALL 只监听 `127.0.0.1`。只有管理员在 Web 设置中显式确认
后才能绑定 LAN；两种模式 SHALL 使用同一多用户认证、session/API Key 和权限检查。

#### Scenario: 默认首次启动

- **WHEN** 用户没有开启 LAN 访问
- **THEN** Server SHALL 只接受本机回环连接
- **AND** Web 管理主页 SHALL 要求正常初始化、登录和授权

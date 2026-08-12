# Canonical Server Development Specification

## Purpose

定义应用本地开发如何复用可发布的统一 LocalApp Server，并把 Dev Toolkit 限制为同一 Server 的显式开发能力。

## Requirements

### Requirement: 本地开发运行可发布的统一 Server

`localapp dev` SHALL 从当前 `localapp` npm package release 启动与个人 daemon、局域网、容器和公网部署相同的 Server runner。CLI SHALL 一次解析其包内 runner，并要求 Node.js 24 或更新版本；不得从 PATH、独立 Server package 或项目依赖切换到另一份实现。CLI SHALL 将 Server 数据放在当前项目 `tmp/localapp-dev/server/` 下，在首次启动时初始化真实 Server 用户，并把当前应用作为唯一版本包通过正式安装端点安装。模板 SHALL NOT 携带或启动另一套 HTTP 应用服务。

#### Scenario: 首次启动开发应用

- **WHEN** 用户在新建应用中执行 `localapp dev`
- **THEN** CLI SHALL 在回环随机端口启动 npm 包内的统一 Server runner
- **AND** Server 数据 SHALL 位于项目 `tmp/localapp-dev/server/`
- **AND** CLI SHALL 初始化 `dev-user` 并取得该用户 API Key
- **AND** CLI SHALL 构建唯一开发版本并调用 `/api/me/apps/install`
- **AND** Vite 启动前应用 SHALL 已能从 `/serve/dev-user/<app>/` 提供正式应用 API

#### Scenario: 修改代码后再次启动

- **WHEN** 用户在不修改 package.json 版本的情况下修改应用并再次执行 `localapp dev`
- **THEN** CLI SHALL 为开发包产生新的唯一版本
- **AND** Server SHALL 把该包视为同名应用版本更新而非 digest 冲突
- **AND** 已有 Server 用户和应用数据 SHALL 保留

#### Scenario: Server runner 与 CLI 同版本

- **WHEN** `localapp dev` 从某个 npm package version 执行
- **THEN** SHALL 使用同一 package release 中的 Server runner
- **AND** SHALL NOT 因 PATH 或项目依赖中存在其它 Server 实现而改变本次运行

#### Scenario: Server 或 Node 前置条件缺失

- **WHEN** CLI 无法验证包内 Server runner，或 Node.js 主版本小于 24
- **THEN** `localapp dev` SHALL 在创建子进程前失败
- **AND** 错误 SHALL 指明重新安装当前 `localapp` npm package 或安装 Node.js 24+

#### Scenario: Vite 退出

- **WHEN** Vite 正常退出、失败或用户中断开发命令
- **THEN** CLI SHALL 终止并等待本次启动的 Server 子进程
- **AND** SHALL NOT 删除项目 Server 数据

### Requirement: 开发与正式应用 API 使用同一路由实现

Vite SHALL 只负责编译前端和转发请求。应用 API SHALL 改写到同一 Server 的 `/serve/<user>/<app>/api/*`；用户、群组、LLM、Issue、上传和其它平台 API SHALL 原样转发到该 Server。开发模式 SHALL NOT 代理或回退到另一台远程 Server。Vite 的 Node 代理 SHALL 在转发时加入 API Key，但 SHALL NOT 把 API Key 注入浏览器模块、DOM、URL 或响应。

#### Scenario: 应用读取 Named SQL

- **WHEN** 开发页面请求 `/api/queries/$records.list`
- **THEN** Vite SHALL 转发到当前 Server 的 `/serve/dev-user/<app>/api/queries/$records.list`
- **AND** 该请求 SHALL 使用与已安装应用相同的认证、backend contract 和数据库实现

#### Scenario: 应用使用平台能力

- **WHEN** 开发页面请求 `/api/me`、`/api/users`、`/api/groups`、`/api/issues` 或 `/api/llm/*`
- **THEN** Vite SHALL 将原路径转发到当前 Server
- **AND** Vite 的 Server-side proxy SHALL 注入 `.localapp/dev-config.json` 中的 API Key
- **AND** 浏览器 SHALL NOT 接收或读取该 API Key
- **AND** 请求 SHALL NOT 访问远程 Server

#### Scenario: 应用 API 名称与平台前缀重叠

- **WHEN** 开发页面请求应用 API `/api/messages`
- **THEN** `/api/me` 平台路由 SHALL NOT 以普通字符串前缀匹配该请求
- **AND** Vite SHALL 将其改写到当前 Server 的 `/serve/dev-user/<app>/api/messages`
- **AND** 每个全局平台例外 SHALL 只匹配其精确路径（可带 query）或以 `/` 分隔的后代路径

### Requirement: dev-config 完整且 Vite 代理限制在回环

`localapp dev` SHALL 以私有权限写入恰好包含 `serverUrl`、`userId`、`pageName`、`apiKey` 和 `appServerPort` 的 `.localapp/dev-config.json`。`serverUrl` SHALL 严格等于 `http://127.0.0.1:<nonzero-port>`，不得包含 userinfo、额外路径、query 或 fragment。Vite serve SHALL 在配置缺失、解析失败或任一字段无效时硬失败；production build SHALL 不要求该文件。开发 Vite SHALL 强制监听 `127.0.0.1`、只允许 localhost/127.0.0.1 Host，并对所有 credential-injecting unsafe API/serve 请求要求同源 Origin 和 HttpOnly/SameSite=Strict 的会话绑定 CSRF cookie。

#### Scenario: 直接启动缺少配置的 Vite

- **WHEN** 用户绕过 CLI 执行 dev Vite 且 canonical dev-config 缺失或不完整
- **THEN** Vite SHALL 以错误退出并提示运行 `localapp dev`
- **AND** SHALL NOT 运行一个无后端或远程降级页面

#### Scenario: dev-config 指向非规范代理目标

- **WHEN** `serverUrl` 使用远程主机、`localhost`、HTTPS、零端口、缺失端口或包含凭据、路径、query、fragment
- **THEN** Vite SHALL 在建立代理或注入 API Key 前硬失败
- **AND** SHALL 提示通过 `localapp dev` 重新生成严格回环配置

#### Scenario: 恶意网页请求本机 dev proxy

- **WHEN** 非允许 Origin 对 `/api/*` 或 `/serve/*` 发起 POST、PUT、PATCH 或 DELETE
- **THEN** Vite SHALL 在注入 API Key 前返回 403
- **AND** 请求 SHALL NOT 到达 canonical Server

#### Scenario: 离线生产构建

- **WHEN** `.localapp/dev-config.json` 不存在且执行 production build
- **THEN** 构建 SHALL 正常完成
- **AND** 产物 SHALL NOT 包含 dev proxy 或 API Key

### Requirement: Dev Toolkit 是显式且隔离的 Server 能力

统一 Server SHALL 仅在 `LOCALAPP_DEV_TOOLS=1` 时注册经过认证的 `/api/dev/*`。普通 daemon、前台、局域网、容器和公网启动 SHALL 返回 404。即使开启，该路由集也 SHALL 只接受 loopback 请求、校验应用名，并证明解析后的应用目录仍位于当前 Server dataDir 下的认证所有者目录。开发上下文 SHALL 以 Server dataDir、用户和应用为键，并在该 Server 关闭时清除。诊断日志 SHALL 只返回当前模拟或认证用户的请求。

#### Scenario: 开发 Server 使用 Dev Toolkit

- **WHEN** `localapp dev` 启动 Server
- **THEN** `/api/dev/context`、`/api/dev/users`、`/api/dev/data/*`、`/api/dev/diagnostics/requests` 和 `/api/dev/business` SHALL 可用
- **AND** 数据 reset/snapshot/restore SHALL 操作已安装应用的同一 Server 数据库和文件
- **AND** 用户选择 SHALL 只接受该 Server 中真实存在的用户

#### Scenario: 普通 Server 不暴露开发路由

- **WHEN** 同一 Server 包未设置 `LOCALAPP_DEV_TOOLS=1` 而启动
- **THEN** `/api/dev/context` SHALL 返回 404
- **AND** 其它正式应用和管理接口 SHALL 保持不变

#### Scenario: 非回环或越界应用上下文

- **WHEN** 非回环客户端调用 `/api/dev/*`，或请求提供非法 pageName/越界路径
- **THEN** Server SHALL 返回 403、400 或 404
- **AND** SHALL NOT 读取或修改其它 dataDir、所有者或应用的数据

#### Scenario: Server 实例关闭后重建

- **WHEN** 一个开发 Server 设置固定时间或模拟身份后关闭
- **AND** 另一个 dataDir 使用相同用户名和应用名启动
- **THEN** 新 Server SHALL 使用默认真实时间和自身用户上下文
- **AND** SHALL NOT 复用前一实例的内存状态

### Requirement: 离线 schema 工作库不是运行时后端

`localapp db reset/migrate/status/types/shell` MAY 在项目 `tmp/localapp-schema/schema.db` 中维护离线 SQLite 工作库，用于 migration、seed、类型生成和检查。该文件 SHALL NOT 提供 HTTP、接收应用请求或代表 `localapp dev` 的业务数据。运行时 reset/snapshot/restore SHALL 通过当前 Server 完成。

#### Scenario: 生成数据库类型

- **WHEN** 用户运行 `localapp db reset` 后运行 `localapp db types`
- **THEN** CLI SHALL 只读写 `tmp/localapp-schema/schema.db`
- **AND** SHALL NOT 修改 `tmp/localapp-dev/server/` 中的运行时应用数据

#### Scenario: Dev Toolkit 重置运行时应用

- **WHEN** 用户从 Dev Toolkit 对已安装应用执行 reset
- **THEN** canonical Server SHALL 验证当前活动版本的显式 migration 快照并只应用该快照中的 migrations
- **AND** 缺失的历史快照 SHALL 先从该版本保留且摘要匹配的 `.localapp` 包安全补建
- **AND** 无 migration 的版本 SHALL 使用显式空快照，不得含糊回退到其它版本或源码目录
- **AND** SHALL NOT 应用项目源码中的 `db/seeds/dev.sql`

#### Scenario: 活动版本 migration 无法恢复时失败关闭

- **WHEN** 用户请求 factory reset 或 Dev Toolkit reset
- **AND** 当前活动版本的 migration 快照缺失或校验失败
- **AND** 该版本保留的 `.localapp` 包也缺失、摘要不匹配或无法安全读取
- **THEN** canonical Server SHALL 返回 HTTP `409` 和错误码 `APP_MIGRATIONS_UNAVAILABLE`
- **AND** SHALL NOT 修改应用数据库或上传文件
- **AND** SHALL NOT 创建安全备份或其它数据操作产物
- **AND** SHALL NOT 回退到源码目录、其它应用版本或任何未验证 migration

### Requirement: 本地开发凭据不可预测且私有

CLI SHALL 使用 CSPRNG 创建本地开发 API Key 和临时密码，稳定保存在项目 `tmp/localapp-dev/` 下的私有文件中。在支持 POSIX 权限的平台上文件模式 SHALL 为 `0600`；Windows SHALL 使用禁用继承且仅授予当前用户访问权的 protected DACL，并在创建临时文件前先保护父目录。CLI 输出 SHALL 只说明凭据文件路径和开发用户名，不得输出凭据值；检测到旧的可预测凭据 SHALL 失败关闭而非继续使用。

#### Scenario: 首次创建本地开发身份

- **WHEN** 项目尚无开发凭据并运行 `localapp dev`
- **THEN** CLI SHALL 生成不可预测 API Key 和密码并以私有权限持久化
- **AND** stdout/stderr SHALL NOT 包含任何凭据值

#### Scenario: 再次启动同一项目

- **WHEN** 私有凭据文件有效且再次运行 `localapp dev`
- **THEN** CLI SHALL 复用同一真实 Server 用户凭据
- **AND** SHALL NOT 重置已有用户、应用数据或权限

#### Scenario: Windows 创建私密凭据

- **WHEN** `localapp dev` 在 Windows 首次写入 API Key、密码或 `dev-config.json`
- **THEN** 文件及其创建目录 SHALL 使用仅当前用户可访问的 protected DACL
- **AND** SHALL NOT 依赖 POSIX mode bit 作为 Windows 访问控制

### Requirement: Server readiness 与进程树共同受监督

CLI SHALL 等待 packaged Server 输出结构化 readiness，最长 15 秒。readiness SHALL 分离用户可见 `url` 与由实际 listener 推导的 `listenUrl`；开发 CLI 只接受严格等于 `http://127.0.0.1:<nonzero-port>` 且无 userinfo、额外路径、query 或 fragment 的 `listenUrl`，不得把持久化 `publicUrl` 当作本地控制地址。Server 提前退出、超时、readiness 无有效 `listenUrl` 或应用安装失败时 SHALL 终止本次进程树且不启动 Vite。运行期间 CLI SHALL 同时监督 Server 和 Vite；任一直接子进程退出或用户中断时 SHALL 先优雅终止两个完整进程树，超时后强制清理并等待所有后代进程。在 Unix SHALL 使用独立进程组；Windows SHALL 以 suspended 状态创建根进程，在任何用户代码执行前将其加入启用 `KILL_ON_JOB_CLOSE` 的 Job Object，然后才恢复主线程，使全部后代从创建时即归属于同一 Job。

#### Scenario: Server readiness 超时

- **WHEN** canonical Server 在 15 秒内没有报告严格有效的回环 `listenUrl`
- **THEN** CLI SHALL 返回非零状态并终止 Server 进程树
- **AND** Vite SHALL NOT 启动

#### Scenario: Server 配置了公网展示 URL

- **WHEN** readiness 的 `url` 是持久化公网地址而实际 listener 在随机回环端口
- **THEN** CLI SHALL 只使用 `listenUrl` 完成初始化、安装、健康检查和 Vite 代理
- **AND** SHALL NOT 向公网地址发送本地开发凭据

#### Scenario: 用户停止开发命令

- **WHEN** 用户向 `localapp dev` 发送中断信号
- **THEN** CLI SHALL 终止并等待 Vite 和 Server 的完整进程树
- **AND** 即使直接子进程先退出，仍 SHALL 清理其存活后代
- **AND** 两个监听端口 SHALL 释放
- **AND** 项目下的 Server 数据 SHALL 保留

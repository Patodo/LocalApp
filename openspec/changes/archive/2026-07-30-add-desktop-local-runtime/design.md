## Context

LocalApp 已有两种运行形态：生产 Server 是多应用 Fastify 宿主，`localapp dev` 则为每个源码工作区启动一个 mini-server 和一个 Vite。Desktop 已内置固定 Node sidecar、Rust 本地数据库和进程监管，但浏览器入口、账号与配置仍绑定单一远端 Server。

本变更要建立第三种正式运行形态：Desktop 管理的个人 Local Runtime。它承载已构建应用而非源码工作区，不要求远端账号，并与生产 Server 共享 manifest、migration、Named SQL、文件和 native app host 契约。与此同时，CLI 和 Desktop 必须能将同一应用显式发布到用户选择的 LocalApp Server。

主要约束：

- 一个 Desktop 实例只维护一个 Local Runtime 进程，应用数量不得线性增加 Node/Vite 进程。
- 社区或本地安装包是不可信输入，不能执行其中的 Node、shell、安装脚本或 Hosted Action。
- 应用包和用户数据必须分离，升级、卸载和发布不得隐式覆盖或复制用户数据。
- 本地应用在默认浏览器运行，不能获得 Tauri 原生权限。
- Windows 是 Desktop 首要平台，但实现和包格式必须跨平台。
- 现有单 Server `config.json`、`localapp dev` 和 `localapp upload` 默认行为需要向后兼容。

## Goals / Non-Goals

**Goals:**

- Desktop 可启动、停止和监控单个多应用 Local Runtime。
- 用户可通过 Desktop 安装、升级、打开和卸载 `.localapp`，无需部署 Server 或安装系统 Node.js。
- Local Runtime 为每个应用提供独立 Origin、SQLite、文件目录、备份目录、本地身份和 Local Platform Shell。
- CLI 可在无登录状态执行本地检查、构建 `.localapp` 并安装到 Desktop。
- CLI 与 Desktop 支持多个命名 Server，并在发布时显式固定一个目标。
- 本地运行、开发态和生产 Server 继续使用同一应用 API contract。

**Non-Goals:**

- 本变更不实现 Community Hub、签名信任链、自动更新市场或源码派生。
- 不实现跨设备同步、离线多人协作、Local Runtime 局域网访问或本地企业用户组。
- 不把 Vite 合并进常驻 Runtime；源码 HMR 仍由 `localapp dev` 临时启动。
- 不在本地执行 Hosted JavaScript Backend Action 或应用携带的任意服务器代码。
- 不自动将本地数据库、文件或 `manifest.platform.json` 发布到远端 Server。
- 不在首版抽取完整通用 Publisher crate；先建立可复用目标解析和一致的发布上下文。
- 不宣称在操作系统或存储硬件突然掉电时，SQLite 与多个目录项具有超越底层文件系统保证的跨文件原子性；本变更保证 Desktop/Runtime 进程中断和普通 I/O 失败后的恢复一致性。

## Decisions

### 1. 新建独立 `packages/local-runtime`

Local Runtime 使用固定 Node sidecar 启动一个独立包，并复用 `@localapp/server-core` 的 Named SQL、migration、内容和 API contract。Desktop 生命周期、Host 路由和安装注册不放入 `server-core`，避免让生产 Server 依赖 Desktop 概念。

生产 Server 的多应用路径和应用上下文解析会提取为可复用构件；Local Runtime 不直接打包当前单应用 `mini-server.mjs`。`localapp dev` 在本变更内保持现有启动方式，后续可以迁移到 Runtime 注册协议。

备选方案是为每个应用启动现有 mini-server。该方案实现快，但应用数量会线性增加 Node 进程和 SQLite/sql.js 内存，违背本变更最核心的资源目标。

### 2. 使用 Host 路由形成每应用独立 Origin

应用正式入口为：

```text
http://<app-id>.localhost:<port>/
```

Runtime 只监听 `127.0.0.1`，解析和验证精确 Host 后建立不可变 `AppRuntimeContext`。静态资源和 `/api/*` 都在该 Origin 下服务，未知 Host、非 loopback Host header 和非法应用 ID直接拒绝。每个上下文显式包含 build root、contract root、数据库文件和文件根目录，所有连接池、队列和缓存使用规范化数据库路径或 app key 分区。

备选方案是 `/apps/<id>/` 路径路由。现有应用使用根路径 API 和资源地址，路径方案需要注入 base、重写 fetch 或 Service Worker，并且不能提供浏览器 Origin 隔离，因此不采用。

### 3. Desktop 控制面与浏览器数据面分离

Rust Controller 启动 Runtime 时生成高熵控制令牌，通过仅当前进程可读的环境变量传入。Runtime 的注册刷新、健康状态和停止端点只接受该令牌；普通应用 Origin 不暴露控制能力。

Desktop 打开应用前向 Runtime 申请一次性短时效 ticket，浏览器首次访问后换取 HttpOnly、SameSite=Strict 的应用会话并从 URL 移除 ticket。写 API 同时校验 Host、Origin、本地会话和 backend contract。关闭 Desktop 主窗口到托盘时 Runtime 保持运行，明确退出应用时优雅停止整个进程树。

备选方案是本地模式完全取消会话。loopback 服务仍可能被恶意网页通过浏览器发起请求，因此不能仅依赖“只监听本机”。

### 4. `.localapp` 是确定性 ZIP，安装包与数据分离

CLI 构建包时先执行本地 check 和 build，再按稳定字典序写入 ZIP。根目录包含 `package.json` 元数据、`manifest.json`、`dist/`、`migrations/`、backend contract 和 `checksums.json`。路径必须是规范化相对路径，拒绝绝对路径、`..`、符号链接、超限文件和超限总大小。

Desktop Rust 安装器在 staging 目录解压，验证 schema、平台兼容范围、manifest identity、文件清单和 SHA-256，再执行 migration 预检并原子切换：

```text
apps/<app-id>/versions/<version>/
app-data/<app-id>/app.db
app-data/<app-id>/files/
app-data/<app-id>/backups/
app-data/<app-id>/manifest.platform.json
```

版本目录不可变。安装器在改动版本目录、活动数据库或双注册表前，先以临时目录写完并原子发布持久化事务日志；日志保存升级前数据库和两个注册表的精确快照及 checksum，并在恢复前验证日志元数据、应用 ID、semver、注册表路径和 SQLite 完整性。候选版本健康检查完成后先停止候选 Runtime，再提交或回滚磁盘事务。全部步骤成功时在独立目录持久保留提交回执，再清理事务日志；提交回执不参与递归清理，日志目录即使在后续进程中断后再次出现也只会被清理，不会回退成功升级。Desktop 重启时发现没有提交回执的日志，一律幂等恢复旧版本、旧数据库和旧注册表，因此 Desktop/Runtime 进程在任意一步退出都不会留下“旧 currentVersion + 新数据库”的混合状态。

升级前创建一致性备份；migration 或新版本健康检查失败时恢复旧 currentVersion 和升级前数据库。卸载和永久删除同样先原子发布删除日志，再移动托管目录和提交注册表；不完整或损坏的日志不得阻断 Desktop 启动，也不得使用未经校验的应用 ID 派生文件路径。卸载默认只移除注册和包版本，保留 `app-data`。

### 5. Local Platform Shell 复用 native app host 契约

Local Runtime 提供和正式 `/{owner}/{app}` 一致的 native app 宿主页，由平台拥有导航、确认框和 overlay，应用只挂载到 app container。Local Shell 隐藏登录、多用户在线和企业 ACL UI，注入稳定的 `local-user` 身份；应用调用 SDK 时不需要判断 local/hosted 模式。

Runtime 内部可以保留 raw asset 路由用于诊断，但 Desktop 和验收只打开正式 Shell 入口，不能把 raw 页面作为用户体验入口。

### 6. Server profile 使用独立 sidecar 配置并一次解析

保留 `~/.localapp/work/config.json` 的旧 `{server_url, api_key}` 结构作为当前目标兼容镜像；新增 `~/.localapp/work/servers.json` 保存 schemaVersion、activeProfile 和命名 profiles。这样旧 CLI 保存配置时不会删除新字段。

目标解析优先级：

1. 完整的 `LOCALAPP_SERVER_URL` + `LOCALAPP_API_KEY` 临时目标；
2. 显式 `--profile`；
3. `LOCALAPP_PROFILE`；
4. 项目 `.localapp/publish.json` 的 `defaultProfile`；
5. `config.json` 兼容目标。

环境临时目标和显式 profile 同时存在时返回冲突错误。命令开始时解析一次 `ResolvedTarget`，随后 capability check、数据库验证、页面注册、上传和 `--verify` 都持有该值，禁止子步骤重新读取全局配置。

`localapp server add/list/use/remove` 管理 profiles；`login --profile` 验证后原子保存目标。API Key 不返回给 Desktop React 层。

### 7. 本地构建、安装和远程发布是独立操作

新增：

```text
localapp build --package [--output <file>]
localapp local install <file>
localapp upload [path] --profile <name>
```

`build --package` 和本地安装不解析远端凭据。`upload --profile` 只上传包中的发布内容，不上传 `app-data`。现有无参数 `upload` 继续使用兼容默认目标。

Desktop 应用库提供“安装应用包”“打开”“卸载”和“发布”命令；首版发布可调用 Rust 共享目标解析并复用 CLI 已有 HTTP contract，但不能 shell-out 到用户 PATH 中的 CLI。

### 8. 故障隔离与资源预算

Runtime 延迟加载每个应用的 manifest、migration 和数据库；单应用注册或 migration 失败只把该应用标记为不可用，不阻止 Runtime 和其他应用启动。数据库维护只能驱逐目标 dbFile 的连接，不能调用全局 close。

Runtime 对请求体、Named SQL 响应、文件上传、静态文件和包安装设置预算。100 个已注册但不活跃的应用只占注册元数据，不预先加载数据库。首版继续使用 sql.js，但用 repository 边界保留未来切换原生 SQLite 驱动的空间。

## Risks / Trade-offs

- [部分 Windows 环境的系统 resolver 不解析 `*.localhost`，但浏览器仍可能按保留域规则解析] → Desktop 启动和打开应用时检查可确认的解析结果；若明确指向非回环地址则阻断并提示清理 DNS、VPN 或 hosts 覆盖，resolver 无结果时不误判为浏览器不可用。测试 Windows 安装包，不静默回退到共享 Origin。
- [Local Runtime bundle 增大 Desktop 体积] → 复用现有固定 Node 二进制，只新增编译后的 Runtime 与必要静态 Shell 资源。
- [生产 Server 代码和 Local Runtime 复用过程中引入回归] → 先提取无副作用的 runtime factory 和共享契约测试，生产入口保持薄适配器。
- [ZIP 解压炸弹或路径穿越] → 解压前校验 entry 数量、压缩/解压大小、路径、文件类型和 checksum，所有写入限定在 staging 根目录。
- [升级过程中进程在 migration、注册表切换或健康检查后退出] → 改动前原子发布持久化安装日志；重启时只要日志仍存在就幂等回退版本、双注册表和数据库，成功完成全部检查后才清理日志。
- [明文 Server API Key 仍存在] → 本变更保持兼容但将 credential access 封装在 Rust；系统 Keychain/Credential Manager 迁移另立变更。
- [Local Runtime 崩溃导致所有本地应用暂时不可用] → Desktop 监控进程并限速重启，保留状态和清晰错误；单进程换取显著更低资源占用。

## Migration Plan

1. 增加 profile sidecar 存储和兼容测试，不改变旧 `config.json` 默认行为。
2. 增加 `.localapp` 构建与验证库、CLI 命令；现有 upload bundle 协议保持兼容。
3. 新增 Local Runtime 与多应用隔离测试，提取共享 Server runtime 构件。
4. 增加 Desktop 注册表、安装事务、Controller 和应用库 UI；打包 Local Runtime 资源。
5. 增加指定 profile 的 CLI/Desktop 发布与端到端测试。
6. 发布 Desktop 时不自动导入任何现有 dev 项目；用户显式构建并安装。

回滚时可以移除 Desktop 的 Local Runtime 入口而不影响远端 Server。已安装包和 `app-data` 保留，旧 CLI 仍通过 `config.json` 工作。

## Open Questions

- 社区签名、Registry 信任根和自动更新策略留给 Community Hub 变更。
- `localapp dev` 何时改为向常驻 Runtime 注册源码项目，留给后续开发体验优化变更。
- 系统凭据管理器迁移和多设备本地数据同步不在本次范围。

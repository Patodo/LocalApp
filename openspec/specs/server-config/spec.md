## Purpose

定义所有部署形态共享的 canonical Server 配置、秘密文件、回环默认值和安全网络重绑定。

## Requirements

### Requirement: 一套 Server 配置模型服务所有部署

`localapp` npm 包的个人 daemon、前台进程、局域网主机、容器和公网部署 SHALL 使用同一 `ServerConfig`。配置 SHALL 包含 data directory、listen host/port、public URL、workspace directory、JWT key file、master key file、存储 provider、外部工具与运行预算。部署形态只能改变配置值，不得选择另一套应用服务实现。

#### Scenario: 新 Server 使用默认配置

- **WHEN** `localapp server run` 在新 data directory 启动且没有监听覆盖
- **THEN** Server SHALL 监听 `127.0.0.1`
- **AND** SHALL 使用该 data directory 下的数据库、应用、内容和 workspace 根

#### Scenario: daemon 启动 Server

- **WHEN** `localapp server` 注册并启动当前用户 daemon
- **THEN** daemon 中的 Server SHALL 读取同一配置模型
- **AND** 应用 API 和 Web control plane SHALL 与前台运行一致

### Requirement: 配置来源与优先级

Server SHALL 先解析 `DATA_DIR`，再读取 data directory 中的持久配置。管理员可修改的公开设置 SHALL 持久化到 `server.json`；其它部署设置 MAY 从 `config.toml` 读取。显式环境变量 SHALL 覆盖持久值，持久值 SHALL 覆盖内置默认值。无效配置 SHALL fail fast 并报告文件路径或字段，不得输出秘密值。

#### Scenario: 环境变量覆盖持久监听端口

- **WHEN** `LISTEN_PORT` 与 `server.json.listenPort` 同时存在
- **THEN** Server SHALL 使用环境变量端口

#### Scenario: 配置文件不存在

- **WHEN** 新 data directory 没有 `server.json` 或 `config.toml`
- **THEN** Server SHALL 使用安全默认值正常进入 setup-only 状态

#### Scenario: 配置文件无效

- **WHEN** 持久配置无法解析或字段越界
- **THEN** Server SHALL 在监听前退出并输出结构化错误

### Requirement: data directory 和 workspace 边界

`DATA_DIR` SHALL 在读取其它配置前确定。相对 `workspaceDir` SHALL 解析到该 data directory 内，绝对路径、`..` 穿越和 symlink escape SHALL 被拒绝。Web Studio SHALL 只访问 `<data-dir>/<workspaceDir>/<workspace-id>`。

#### Scenario: 合法 workspace 设置

- **WHEN** `workspaceDir` 为 `workspaces`
- **THEN** Server SHALL 使用 `<data-dir>/workspaces`

#### Scenario: workspace 越界

- **WHEN** 配置尝试把 workspace 指向 data directory 外
- **THEN** Server SHALL 拒绝配置且不创建越界目录

### Requirement: Server 自动生成实例秘密

未显式提供 JWT secret 时，Server SHALL 在 `jwtKeyFile` 一次性生成高熵签名密钥；peer credential 和其它受保护数据 SHALL 使用独立 `masterKeyFile`。Unix 上秘密文件 SHALL 使用限制权限。系统设置 API、日志和 readiness SHALL NOT 返回这些秘密。

#### Scenario: clean start 生成密钥

- **WHEN** 新 data directory 中没有 JWT 或 master key 文件
- **THEN** Server SHALL 创建两个独立秘密文件
- **AND** 后续重启 SHALL 复用它们

#### Scenario: Web 查询系统设置

- **WHEN** admin 请求系统设置
- **THEN** 响应 SHALL 包含公开监听、URL 和 workspace 配置
- **AND** SHALL NOT包含 JWT、master key、存储凭据或 Device control token

### Requirement: clean setup 不由配置创建固定用户

Server 配置 SHALL NOT包含默认管理员用户名或密码，也 SHALL NOT在启动时自动创建固定用户。`BOOTSTRAP_API_KEY` MAY 作为自动化输入，在 setup 成功时绑定给用户提交的首位管理员；没有成功 setup 时不得产生用户或 API Key。

#### Scenario: 配置 bootstrap API Key 后启动空 Server

- **WHEN** 新 Server 设置 `BOOTSTRAP_API_KEY`
- **THEN** Server SHALL 仍保持零用户并发布 setup URL
- **AND** setup 创建的管理员 SHALL 获得该 API Key

#### Scenario: setup 用户名由操作者决定

- **WHEN** setup 提交用户名 `owner`
- **THEN** Server SHALL 创建 `owner`
- **AND** SHALL NOT派生或创建固定名称管理员

### Requirement: LAN 访问必须显式启用

非 loopback listener SHALL 要求管理员显式设置 `allowInsecureLan` 或采用 HTTPS/可信反向代理配置。Web 网络设置变更 SHALL 先验证候选地址、持久化 pending 配置、响应请求，再由 supervisor 重启 worker；新 listener 失败 SHALL 回滚旧配置。

#### Scenario: 未确认 LAN 监听

- **WHEN** 管理员尝试把 host 改为 `0.0.0.0` 但未确认 insecure LAN
- **THEN** Server SHALL 拒绝保存

#### Scenario: 重绑定成功

- **WHEN** 候选地址可监听且管理员确认
- **THEN** API SHALL 返回 202
- **AND** supervisor SHALL 重启 worker 并提交新配置

#### Scenario: 重绑定失败

- **WHEN** 新 worker 无法监听候选地址
- **THEN** supervisor SHALL 恢复先前配置和 listener

### Requirement: 配置下发端点不暴露秘密

认证后的 `GET /api/config` MAY 返回应用初始化所需的 `templateRepoUrl` 与 `gitDownloadUrl`。未配置模板仓库时 SHALL 返回空值，CLI SHALL 回退 builtin template。该端点 SHALL NOT返回 Server secret、用户 API Key 或存储凭据。

#### Scenario: templateRepoUrl 为空

- **WHEN** Server 未配置模板仓库
- **THEN** `/api/config` SHALL 返回空 `templateRepoUrl`
- **AND** CLI init SHALL 使用内置模板

### Requirement: CLI 配置目录可隔离

`LOCALAPP_CONFIG_DIR` SHALL 覆盖 CLI 默认配置目录，使测试和本地验收可把 profile 凭据放在仓库 `tmp/` 的明确子目录。

#### Scenario: 使用仓库内临时配置

- **WHEN** 设置 `LOCALAPP_CONFIG_DIR=<repo>/tmp/acceptance/cli-config`
- **THEN** CLI SHALL 只在该目录读取和写入连接配置
- **AND** 用户默认配置 SHALL 保持不变

## ADDED Requirements

### Requirement: 服务器从 config.toml 加载配置

服务器 SHALL 在启动时从 `{DATA_DIR}/config.toml` 读取 TOML 格式的配置文件。若文件不存在，SHALL 使用内置默认值继续运行。

#### Scenario: config.toml 存在且有效
- **WHEN** `{DATA_DIR}/config.toml` 存在且包含有效的 TOML 内容
- **THEN** 服务器使用 config.toml 中的值作为配置（未被环境变量覆盖的部分）

#### Scenario: config.toml 不存在
- **WHEN** `{DATA_DIR}/config.toml` 不存在
- **THEN** 服务器使用内置默认值正常启动，不报错

#### Scenario: config.toml 格式无效
- **WHEN** `{DATA_DIR}/config.toml` 存在但 TOML 格式无效
- **THEN** 服务器输出错误信息并拒绝启动，错误信息 SHALL 包含文件路径和解析失败原因

### Requirement: 配置优先级为环境变量 > config.toml > 默认值

服务器 SHALL 对每个配置项按以下优先级查找：环境变量 > config.toml 中的对应字段 > 内置默认值。找到第一个非空值即使用。

#### Scenario: 环境变量覆盖 config.toml
- **WHEN** 环境变量 `PORT=4000` 且 config.toml 中 `server.port = 3000`
- **THEN** 服务器监听端口 4000

#### Scenario: config.toml 覆盖默认值
- **WHEN** 环境变量 `PORT` 未设置且 config.toml 中 `server.port = 4000`
- **THEN** 服务器监听端口 4000

#### Scenario: 使用内置默认值
- **WHEN** 环境变量 `PORT` 未设置且 config.toml 中未配置 `server.port`
- **THEN** 服务器监听端口 3000（内置默认值）

### Requirement: DATA_DIR 的确定先于配置文件读取

服务器 SHALL 先从环境变量 `DATA_DIR` 或默认值 `"./data"` 确定数据目录，再从该目录读取 config.toml。config.toml 中的 `server.data_dir` 字段 SHALL NOT 影响已确定的 DATA_DIR。

#### Scenario: config.toml 中配置了不同的 data_dir
- **WHEN** 环境变量 `DATA_DIR` 未设置（使用默认 `./data`），且 config.toml 中 `server.data_dir = "/other/data"`
- **THEN** 服务器使用 `./data` 作为数据目录，忽略 config.toml 中的 `server.data_dir`

### Requirement: 统一配置模块消除硬编码重复

服务器 SHALL 通过统一的配置模块（`lib/config.ts`）提供所有配置项的读取，各路由和插件 SHALL NOT 直接调用 `process.env` 读取配置。`DATA_DIR` 默认值 `"./data"` SHALL 只在配置模块中出现一次。

#### Scenario: 路由读取配置
- **WHEN** 任何路由或插件需要获取 `DATA_DIR` 配置
- **THEN** 通过 `app.config.DATA_DIR` 或配置模块提供的接口获取，不直接读 `process.env.DATA_DIR`

### Requirement: 必填配置项缺少时的友好错误提示

服务器 SHALL 在启动时检查必填配置项（如 `TEMPLATE_REPO_URL`）。若缺少，SHALL 输出错误信息指明"可通过环境变量 `TEMPLATE_REPO_URL` 或 config.toml 的 `template.repo_url` 配置"，然后拒绝启动。

#### Scenario: TEMPLATE_REPO_URL 未通过任何方式配置
- **WHEN** 环境变量 `TEMPLATE_REPO_URL` 未设置且 config.toml 中 `template.repo_url` 为空或未配置
- **THEN** 服务器输出包含环境变量和 config.toml 两种配置方式的错误信息，进程退出

#### Scenario: TEMPLATE_REPO_URL 通过 config.toml 配置
- **WHEN** 环境变量 `TEMPLATE_REPO_URL` 未设置但 config.toml 中 `template.repo_url = "https://example.com/template"`
- **THEN** 服务器正常启动

### Requirement: config.toml 配置文件格式

config.toml SHALL 支持以下结构：

```toml
[server]
port = 3000
data_dir = "./data"

[auth]
jwt_secret = ""
bootstrap_api_key = ""

[template]
repo_url = ""
git_download_url = ""

[admin]
static_dir = ""

[cli]
min_version = ""
```

所有字段均为可选，缺失字段使用内置默认值。

#### Scenario: 部分字段配置
- **WHEN** config.toml 只包含 `[server]` 和 `[auth]` 部分
- **THEN** `[template]`、`[admin]`、`[cli]` 部分使用内置默认值

### Requirement: CLI 支持 LOCALAPP_CONFIG_DIR 环境变量

CLI SHALL 支持环境变量 `LOCALAPP_CONFIG_DIR` 覆盖默认的配置目录 `~/.localapp/work/`。设置后，CLI 从 `{LOCALAPP_CONFIG_DIR}/config.json` 读取配置。

#### Scenario: LOCALAPP_CONFIG_DIR 已设置
- **WHEN** 环境变量 `LOCALAPP_CONFIG_DIR=/tmp/qw-config`
- **THEN** CLI 从 `/tmp/qw-config/config.json` 读取 server_url 和 api_key

#### Scenario: LOCALAPP_CONFIG_DIR 未设置
- **WHEN** 环境变量 `LOCALAPP_CONFIG_DIR` 未设置
- **THEN** CLI 从 `~/.localapp/work/config.json` 读取配置（现有行为不变）

## MODIFIED Requirements

### Requirement: 服务器配置下发端点

服务器 SHALL 提供 `GET /api/config` 端点（需鉴权），返回 `templateRepoUrl` 和 `gitDownloadUrl`（可选）。配置来源 SHALL 为环境变量 > config.toml > 默认值的合并结果。

#### Scenario: 获取配置
- **WHEN** 发送 `GET /api/config`（携带有效 API Key）
- **THEN** 返回 `{"templateRepoUrl": "...", "gitDownloadUrl": "..." | null}`，HTTP 200

#### Scenario: 未鉴权
- **WHEN** 发送 `GET /api/config`（无 API Key 或无效 Key）
- **THEN** 返回 `{"error": "Unauthorized"}`，HTTP 401

### Requirement: TEMPLATE_REPO_URL 环境变量为必配项

服务器 SHALL 在启动时检查 `TEMPLATE_REPO_URL` 配置（来源为环境变量或 config.toml），未配置则拒绝启动并输出友好的配置指引。

#### Scenario: 未配置 TEMPLATE_REPO_URL
- **WHEN** 服务器启动时 `TEMPLATE_REPO_URL` 环境变量未设置且 config.toml 中 `template.repo_url` 为空或未配置
- **THEN** 输出包含两种配置方式的错误信息，进程退出

#### Scenario: 已配置 TEMPLATE_REPO_URL（通过环境变量）
- **WHEN** 服务器启动时 `TEMPLATE_REPO_URL` 环境变量已设置为有效 Git 仓库 URL
- **THEN** 正常启动，`/api/config` 返回该 URL

#### Scenario: 已配置 TEMPLATE_REPO_URL（通过 config.toml）
- **WHEN** 服务器启动时 config.toml 中 `template.repo_url` 已设置为有效 Git 仓库 URL
- **THEN** 正常启动，`/api/config` 返回该 URL

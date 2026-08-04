## Purpose

This spec describes the expected behavior, acceptance criteria, and integration boundaries for the server-config capability in LocalApp.

## Requirements

### Requirement: 服务器配置下发端点

服务器 SHALL 提供 `GET /api/config` 端点（需鉴权），返回 `templateRepoUrl` 和 `gitDownloadUrl`（可选）。配置来源 SHALL 为环境变量 > config.toml > 默认值的合并结果。

#### Scenario: 获取配置
- **WHEN** 发送 `GET /api/config`（携带有效 API Key）
- **THEN** 返回 `{"templateRepoUrl": "...", "gitDownloadUrl": "..." | null}`，HTTP 200

#### Scenario: 未鉴权
- **WHEN** 发送 `GET /api/config`（无 API Key 或无效 Key）
- **THEN** 返回 `{"error": "Unauthorized"}`，HTTP 401

### Requirement: TEMPLATE_REPO_URL 环境变量为必配项

服务器 SHALL 在启动时将 `TEMPLATE_REPO_URL` 作为可选配置项处理。未配置时，服务器 SHALL 正常启动，`GET /api/config` 端点返回空字符串作为 `templateRepoUrl` 字段值。使用远程模板克隆功能（如 `init` 命令的非 builtin 模式）时，若 `TEMPLATE_REPO_URL` 未配置，服务端 SHALL 返回明确的错误信息。

#### Scenario: 未配置 TEMPLATE_REPO_URL
- **WHEN** 服务器启动时 `TEMPLATE_REPO_URL` 环境变量未设置且 config.toml 中 `template.repo_url` 为空或未配置
- **THEN** 服务器正常启动，`GET /api/config` 返回 `{"templateRepoUrl": "", "gitDownloadUrl": null}`

#### Scenario: 已配置 TEMPLATE_REPO_URL（通过环境变量）
- **WHEN** 服务器启动时 `TEMPLATE_REPO_URL` 环境变量已设置为有效 Git 仓库 URL
- **THEN** 正常启动，`/api/config` 返回该 URL

#### Scenario: 已配置 TEMPLATE_REPO_URL（通过 config.toml）
- **WHEN** 服务器启动时 config.toml 中 `template.repo_url` 已设置为有效 Git 仓库 URL
- **THEN** 正常启动，`/api/config` 返回该 URL

#### Scenario: CLI 收到空 templateRepoUrl 时回退到内置模板
- **WHEN** `GET /api/config` 返回 `templateRepoUrl` 为空字符串且 CLI 执行 `init`（非 builtin 模式）
- **THEN** CLI 自动回退到内置模板，正常完成项目初始化

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

服务器 SHALL 对每个配置项按以下优先级查找：环境变量 > config.toml 中的对应字段 > 内置默认值。找到第一个非空值即使用。对于布尔配置项，环境变量值 `"true"` / `"false"` 字符串 SHALL 转换为布尔值。

`allow_register`、`registration_key` 和 `auto_register_pattern` 配置项 SHALL NOT 参与运行时行为。服务器读取旧 config.toml 中的这些字段时 SHALL 忽略并输出一次不含字段值的弃用警告。

#### Scenario: 环境变量覆盖 config.toml
- **WHEN** 环境变量 `PORT=4000` 且 config.toml 中 `server.port = 3000`
- **THEN** 服务器监听端口 4000

#### Scenario: config.toml 覆盖默认值
- **WHEN** 环境变量 `PORT` 未设置且 config.toml 中 `server.port = 4000`
- **THEN** 服务器监听端口 4000

#### Scenario: 使用内置默认值
- **WHEN** 环境变量 `PORT` 未设置且 config.toml 中未配置 `server.port`
- **THEN** 服务器监听端口 3000（内置默认值）

#### Scenario: 环境变量覆盖 admin_default_password
- **WHEN** 环境变量 `ADMIN_DEFAULT_PASSWORD=mypassword` 且 config.toml 中未配置 `auth.admin_default_password`
- **THEN** bootstrap admin 默认密码为 `mypassword`
- **AND** 普通用户创建和密码重置不使用该值

#### Scenario: 旧自动注册配置被忽略
- **WHEN** 旧配置包含 `AUTO_REGISTER_PATTERN`、`auth.auto_register_pattern` 或 `registration_key`
- **THEN** 服务器忽略这些值并正常启动
- **AND** 输出一次不包含配置值的弃用警告

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

服务器 SHALL 在启动时检查必填配置项。若缺少，SHALL 输出错误信息指明配置方式和格式，然后拒绝启动。`TEMPLATE_REPO_URL` 不属于必填配置项。

#### Scenario: TEMPLATE_REPO_URL 未通过任何方式配置
- **WHEN** 环境变量 `TEMPLATE_REPO_URL` 未设置且 config.toml 中 `template.repo_url` 为空或未配置
- **THEN** 服务器正常启动（不报错、不退出）

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
admin_default_password = "localadmin"

[template]
repo_url = ""
git_download_url = ""

[admin]
static_dir = ""

[cli]
min_version = ""
release_manifest_url = ""
```

所有字段均为可选，缺失字段使用内置默认值。`allow_register`、`registration_key` 和 `auto_register_pattern` 字段 SHALL NOT 作为有效配置存在。

#### Scenario: 部分字段配置
- **WHEN** config.toml 只包含 `[server]` 和 `[auth]` 部分
- **THEN** `[template]`、`[admin]`、`[cli]` 部分使用内置默认值

#### Scenario: auth 字段缺失
- **WHEN** config.toml 中 `[auth]` 部分未配置 `admin_default_password`
- **THEN** bootstrap admin 使用现有 `admin_default_password` 默认值

#### Scenario: 配置发行清单
- **WHEN** 环境变量 `LOCALAPP_RELEASE_MANIFEST_URL` 或 config.toml 的 `cli.release_manifest_url` 设置为 HTTPS URL
- **THEN** Server 使用环境变量优先级解析后的 URL 获取 CLI 发行清单

### Requirement: CLI 支持 LOCALAPP_CONFIG_DIR 环境变量

CLI SHALL 支持环境变量 `LOCALAPP_CONFIG_DIR` 覆盖默认的配置目录 `~/.localapp/work/`。设置后，CLI 从 `{LOCALAPP_CONFIG_DIR}/config.json` 读取配置。

#### Scenario: LOCALAPP_CONFIG_DIR 已设置
- **WHEN** 环境变量 `LOCALAPP_CONFIG_DIR=/tmp/qw-config`
- **THEN** CLI 从 `/tmp/qw-config/config.json` 读取 server_url 和 api_key

#### Scenario: LOCALAPP_CONFIG_DIR 未设置
- **WHEN** 环境变量 `LOCALAPP_CONFIG_DIR` 未设置
- **THEN** CLI 从 `~/.localapp/work/config.json` 读取配置（现有行为不变）

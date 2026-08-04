## MODIFIED Requirements

### Requirement: 配置优先级为环境变量 > config.toml > 默认值

服务器 SHALL 对每个配置项按以下优先级查找：环境变量 > config.toml 中的对应字段 > 内置默认值。找到第一个非空值即使用。对于布尔配置项，环境变量值 `"true"` / `"false"` 字符串 SHALL 转换为布尔值。

`allow_register` 和 `registration_key` 配置项 SHALL NOT 存在于环境变量或 config.toml 中。registration key SHALL 从共享文件读取（见独立 requirement）。

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
- **THEN** admin 默认密码为 `mypassword`

#### Scenario: 环境变量覆盖 auto_register_pattern
- **WHEN** 环境变量 `AUTO_REGISTER_PATTERN=^EMP[0-9]+$` 且 config.toml 中未配置
- **THEN** 工号正则为 `^EMP[0-9]+$`

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
auto_register_pattern = "^[a-z][a-z0-9_]*$"

[template]
repo_url = ""
git_download_url = ""

[admin]
static_dir = ""

[cli]
min_version = ""
```

所有字段均为可选，缺失字段使用内置默认值。`allow_register` 和 `registration_key` 字段 SHALL NOT 存在（已移除）。

#### Scenario: 部分字段配置
- **WHEN** config.toml 只包含 `[server]` 和 `[auth]` 部分
- **THEN** `[template]`、`[admin]`、`[cli]` 部分使用内置默认值

#### Scenario: auth 字段缺失
- **WHEN** config.toml 中 `[auth]` 部分未配置 `admin_default_password`、`auto_register_pattern`
- **THEN** 使用默认值：`admin_default_password="localadmin"`、`auto_register_pattern="^[a-z][a-z0-9_]*$"`

## ADDED Requirements

### Requirement: Registration key 从共享文件读取

服务器 SHALL 在启动时从共享文件读取 registration key。该 key 用于验证 `POST /api/auth/cli-register` 请求中的 `X-Registration-Key` 头。SHALL NOT 从环境变量或 config.toml 读取 registration key。

读取路径 SHALL 按以下优先级查找：
1. `/app/.registration-key`（Docker 容器内固定路径）
2. `packages/shared/.registration-key`（开发环境，相对于仓库根）

文件内容为一行随机字符串，读取时 SHALL 去除首尾空白。

#### Scenario: 共享文件存在（开发环境）
- **WHEN** 服务器启动且 `packages/shared/.registration-key` 文件存在
- **THEN** 读取文件内容（去除首尾空白）作为 registration key，`cli-register` 端点正常工作

#### Scenario: 共享文件存在（Docker 环境）
- **WHEN** 服务器在 Docker 容器中启动，`/app/.registration-key` 文件存在
- **THEN** 从该路径读取 registration key

#### Scenario: 共享文件不存在
- **WHEN** 服务器启动且所有候选路径的共享文件均不存在
- **THEN** registration key 为空字符串，`cli-register` 端点对所有请求返回 403

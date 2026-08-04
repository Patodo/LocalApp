## MODIFIED Requirements

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

## REMOVED Requirements

### Requirement: Registration key 从共享文件读取

**Reason**: 共享文件中的 registration key 会被复制到客户端和镜像，公开发布后无法保持秘密。

**Migration**: 删除共享文件、读取逻辑和 Docker 复制步骤；新用户由管理员供应，旧自动注册端点只返回无副作用的迁移响应。

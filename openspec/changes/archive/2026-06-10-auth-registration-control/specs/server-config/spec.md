## MODIFIED Requirements

### Requirement: config.toml 配置文件格式

config.toml SHALL 支持以下结构：

```toml
[server]
port = 3000
data_dir = "./data"

[auth]
jwt_secret = ""
bootstrap_api_key = ""
allow_register = false
admin_default_password = "localadmin"
registration_key = ""
auto_register_pattern = "^[a-z][a-z0-9_]*$"

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

#### Scenario: auth 新增字段缺失
- **WHEN** config.toml 中 `[auth]` 部分未配置 `allow_register`、`admin_default_password`、`registration_key`、`auto_register_pattern`
- **THEN** 使用默认值：`allow_register=false`、`admin_default_password="localadmin"`、`registration_key=""`（不启用）、`auto_register_pattern="^[a-z][a-z0-9_]*$"`

### Requirement: 配置优先级为环境变量 > config.toml > 默认值

服务器 SHALL 对每个配置项按以下优先级查找：环境变量 > config.toml 中的对应字段 > 内置默认值。找到第一个非空值即使用。对于布尔配置项（如 `allow_register`），环境变量值 `"true"` / `"false"` 字符串 SHALL 转换为布尔值。

#### Scenario: 环境变量覆盖 allow_register
- **WHEN** 环境变量 `ALLOW_REGISTER=true` 且 config.toml 中 `auth.allow_register = false`
- **THEN** `allow_register` 生效值为 `true`

#### Scenario: 环境变量覆盖 admin_default_password
- **WHEN** 环境变量 `ADMIN_DEFAULT_PASSWORD=mypassword` 且 config.toml 中未配置 `auth.admin_default_password`
- **THEN** admin 默认密码为 `mypassword`

#### Scenario: 环境变量覆盖 registration_key
- **WHEN** 环境变量 `REGISTRATION_KEY=abc123` 且 config.toml 中未配置 `auth.registration_key`
- **THEN** 注册凭证为 `abc123`

#### Scenario: 环境变量覆盖 auto_register_pattern
- **WHEN** 环境变量 `AUTO_REGISTER_PATTERN=^EMP[0-9]+$` 且 config.toml 中未配置
- **THEN** 工号正则为 `^EMP[0-9]+$`

## MODIFIED Requirements

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

### Requirement: 必填配置项缺少时的友好错误提示

服务器 SHALL 在启动时检查必填配置项。若缺少，SHALL 输出错误信息指明配置方式和格式，然后拒绝启动。`TEMPLATE_REPO_URL` 不属于必填配置项。

#### Scenario: TEMPLATE_REPO_URL 未通过任何方式配置
- **WHEN** 环境变量 `TEMPLATE_REPO_URL` 未设置且 config.toml 中 `template.repo_url` 为空或未配置
- **THEN** 服务器正常启动（不报错、不退出）

#### Scenario: TEMPLATE_REPO_URL 通过 config.toml 配置
- **WHEN** 环境变量 `TEMPLATE_REPO_URL` 未设置但 config.toml 中 `template.repo_url = "https://example.com/template"`
- **THEN** 服务器正常启动

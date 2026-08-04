## ADDED Requirements

### Requirement: Server 版本检查

Server SHALL 在 auth hook 中校验请求的 `X-CLI-Version` header。若 header 缺失或版本号低于 `MIN_CLI_VERSION` 环境变量指定的值，MUST 返回 HTTP 403 并提示用户执行 `localapp update`。Update 相关端点（`/api/cli/version`、`/api/cli/download`）MUST 绕过版本检查。

#### Scenario: 版本满足要求
- **WHEN** 请求携带 `X-CLI-Version: 0.2.0` 且 `MIN_CLI_VERSION=0.1.0`
- **THEN** 版本检查通过，请求正常处理

#### Scenario: 版本过低
- **WHEN** 请求携带 `X-CLI-Version: 0.1.0` 且 `MIN_CLI_VERSION=0.2.0`
- **THEN** 返回 HTTP 403，响应体 `{ "success": false, "error": "CLI version 0.1.0 is outdated. Minimum required: 0.2.0. Run `localapp update` to upgrade." }`

#### Scenario: 无版本 header（旧 CLI）
- **WHEN** 请求未携带 `X-CLI-Version` header 且 `MIN_CLI_VERSION` 已设置
- **THEN** 返回 HTTP 403，响应体 `{ "success": false, "error": "CLI version unknown. Run `localapp update` to upgrade." }`

#### Scenario: 未设置最低版本
- **WHEN** `MIN_CLI_VERSION` 环境变量未设置或为空
- **THEN** 跳过版本检查，所有请求放行

### Requirement: 版本查询接口

Server SHALL 提供 `GET /api/cli/version` 接口，返回版本清单。MUST 需要有效的 API Key，MUST 不受版本检查拦截。

#### Scenario: 查询成功
- **WHEN** 发送 `GET /api/cli/version` 携带有效 API Key
- **THEN** 返回 `versions.json` 内容，包含 `min`、`latest`、`versions` 字段

#### Scenario: versions.json 不存在
- **WHEN** 发送 `GET /api/cli/version` 但 `static/cli/versions.json` 不存在
- **THEN** 返回 HTTP 404，响应体 `{ "success": false, "error": "No CLI versions available" }`

### Requirement: 二进制下载接口

Server SHALL 提供 `GET /api/cli/download` 接口，返回指定平台和版本的最新 CLI 二进制文件。MUST 需要有效的 API Key，MUST 不受版本检查拦截。

#### Scenario: 下载最新版本
- **WHEN** 发送 `GET /api/cli/download?os=windows&arch=x86_64` 携带有效 API Key
- **THEN** 返回 `static/cli/{latest}/localapp-cli-x86_64-pc-windows-msvc.exe` 文件，Content-Type 为 `application/octet-stream`

#### Scenario: 指定版本下载
- **WHEN** 发送 `GET /api/cli/download?os=linux&arch=x86_64&version=0.1.0` 携带有效 API Key
- **THEN** 返回 `static/cli/0.1.0/localapp-cli-x86_64-unknown-linux-gnu` 文件

#### Scenario: 平台不匹配
- **WHEN** 请求的平台/架构在 `versions.json` 中不存在
- **THEN** 返回 HTTP 404，响应体 `{ "success": false, "error": "No binary for platform: {os}/{arch}" }`

### Requirement: CLI update 命令

CLI SHALL 提供 `update` 子命令，从已配置的 Server 下载最新二进制并替换当前运行的 CLI。

#### Scenario: 成功更新
- **WHEN** 执行 `localapp update`，Server 返回版本信息且存在对应平台的二进制
- **THEN** 下载二进制到临时文件 `~/.localapp/work/localapp-cli.download`，移动替换当前可执行文件，输出 `{"success": true, "version": "0.2.0"}`

#### Scenario: 已是最新版本
- **WHEN** 执行 `localapp update`，CLI 版本等于 `versions.json` 中的 `latest`
- **THEN** 输出 `{"success": true, "message": "Already up to date (v0.2.0)"}`, 不下载

#### Scenario: 未配置 Server
- **WHEN** 执行 `localapp update` 且未配置 serverUrl 或 apiKey
- **THEN** 输出错误 JSON `{"error": "Not configured. Run 'localapp login' first."}`

### Requirement: CLI 版本 header

CLI Client SHALL 在所有 HTTP 请求中附带 `X-CLI-Version` header，值为编译时嵌入的 Cargo.toml version。

#### Scenario: 请求附带版本 header
- **WHEN** CLI 发出任何 HTTP 请求
- **THEN** 请求包含 `X-CLI-Version` header，值为当前 CLI 版本（如 `0.1.0`）

### Requirement: Windows 自替换

在 Windows 平台上，CLI SHALL 通过 rename 策略替换自身：将当前运行的可执行文件重命名为 `.old` 后缀，然后将下载的新二进制移动到原路径。下次 CLI 启动时 SHALL 清理同目录下的 `.old` 文件。

#### Scenario: Windows 替换成功
- **WHEN** 在 Windows 上执行 `localapp update`
- **THEN** 当前 exe 被重命名为 `localapp-cli.old.exe`，新文件写入原名路径，命令正常退出

### Requirement: Unix 自替换

在 Linux/macOS 平台上，CLI SHALL 直接覆盖替换当前可执行文件，并设置可执行权限。

#### Scenario: Unix 替换成功
- **WHEN** 在 Linux/macOS 上执行 `localapp update`
- **THEN** 新文件覆盖旧文件，权限设为 0755，命令正常退出

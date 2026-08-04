## Purpose

CLI 版本管理与自动更新机制。确保 CLI 与 Server 之间的版本兼容性：Server 声明最低兼容版本，CLI 携带版本号并在不兼容时被引导更新。

## Requirements

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

Server SHALL 提供鉴权后的 `GET /api/cli/version` 兼容接口，从配置的发行清单 URL 获取并校验 GitHub Release 元数据。该接口 MUST 不受 CLI 最低版本检查拦截。

#### Scenario: 查询成功
- **WHEN** 客户端携带有效 API Key 请求 `GET /api/cli/version`
- **AND** 远端发行清单通过 HTTPS、大小限制和 schema 校验
- **THEN** 返回包含 `min`、`latest`、平台资产 URL、大小和 SHA-256 的归一化清单

#### Scenario: 远端清单暂时不可用
- **WHEN** 发行清单请求失败但 Server 存在未超过容忍期限的最后成功缓存
- **THEN** 返回缓存清单并标记其获取时间

#### Scenario: 无可用清单
- **WHEN** 远端清单请求失败且无可用缓存或 fallback
- **THEN** 返回 HTTP 503 和稳定错误码 `CLI_RELEASE_MANIFEST_UNAVAILABLE`

### Requirement: 二进制下载接口

Server SHALL 提供鉴权后的 `GET /api/cli/download` 兼容接口。Server MUST 仅从已校验发行清单选择与 `os`、`arch` 和可选 `version` 精确匹配的 HTTPS 资产 URL，并返回下载重定向。

#### Scenario: 下载最新版本
- **WHEN** 请求 `GET /api/cli/download?os=windows&arch=x86_64` 且清单存在匹配资产
- **THEN** 返回到该清单资产 URL 的临时重定向
- **AND** 响应包含预期文件名、大小和 SHA-256 元数据

#### Scenario: 指定版本下载
- **WHEN** 请求包含受支持的明确 `version`
- **THEN** Server 只选择该版本和目标平台完全匹配的清单条目

#### Scenario: 平台不匹配
- **WHEN** 请求的平台、架构或版本在清单中不存在
- **THEN** 返回 HTTP 404 和稳定错误码 `CLI_ASSET_NOT_FOUND`

#### Scenario: 清单包含不安全 URL
- **WHEN** 匹配资产 URL 不是 HTTPS 或不满足配置的发行来源约束
- **THEN** Server 拒绝重定向并返回发行清单无效错误

### Requirement: CLI update 命令

CLI SHALL 提供 `update` 子命令，通过已配置 Server 发现版本并下载对应平台资产。CLI MUST 在替换当前可执行文件前校验下载长度和 SHA-256。

#### Scenario: 成功更新
- **WHEN** 执行 `localapp update`，Server 返回更高版本及匹配资产
- **THEN** CLI 跟随 HTTPS 重定向下载到同文件系统临时文件
- **AND** 大小和 SHA-256 校验通过后替换当前可执行文件并输出新版本

#### Scenario: 摘要校验失败
- **WHEN** 下载内容与清单中的大小或 SHA-256 不一致
- **THEN** CLI 删除临时文件并返回完整性错误
- **AND** 当前可执行文件保持不变

#### Scenario: 已是最新版本
- **WHEN** CLI 版本等于发行清单中的 `latest`
- **THEN** 输出已是最新版本且不下载资产

#### Scenario: 未配置 Server
- **WHEN** 执行 `localapp update` 且未配置 Server URL 或 API Key
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

### Requirement: CLI versions 清单更新

Release workflow SHALL 为每个版本生成 `release-manifest.json`，记录 `latest`、`min` 和各平台资产的 HTTPS URL、文件名、大小、SHA-256 与签名状态。Server MUST 消费该清单，而不是依赖源码树内手工维护的二进制目录。

#### Scenario: 发布步骤生成清单
- **WHEN** 所有目标平台构建完成
- **THEN** 清单的 `latest` 等于当前 Cargo package version
- **AND** 每个已发布平台资产都有可验证条目

#### Scenario: 清单与资产不一致
- **WHEN** 清单缺失资产、存在重复目标或摘要与实际文件不符
- **THEN** release workflow 失败且不发布正式 Release

### Requirement: 容器环境 CLI 下载可用

LocalApp 以生产 Docker 镜像运行时，CLI 版本查询和下载接口 SHALL 使用配置的发行清单和最后成功缓存，不依赖镜像内 CLI 二进制。

#### Scenario: 容器内查询 CLI 版本
- **WHEN** 容器配置了可用发行清单且收到有效鉴权的版本查询
- **THEN** Server 返回经校验的发行元数据

#### Scenario: 容器内下载 CLI 二进制
- **WHEN** 容器收到有效鉴权且目标平台存在的下载请求
- **THEN** Server 返回到经校验发行资产的临时重定向

## MODIFIED Requirements

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

## REMOVED Requirements

### Requirement: CLI release 产物落盘

**Reason**: 将跨平台二进制写入 Server 源码目录会污染公开仓库并使容器构建与客户端发行耦合。

**Migration**: GitHub Actions 为各平台构建资产并发布到 GitHub Release；Server 通过发行清单发现资产。

### Requirement: CLI release 目录为内部发布约定

**Reason**: `packages/server/static/cli` 不再作为二进制发行目录。

**Migration**: 用户通过 Server 兼容接口或 GitHub Release 获取 CLI，页面不得暴露仓库内部路径。

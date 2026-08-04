## Purpose

定义通过 GitHub Release 和 GHCR 发布可验证客户端资产与 Server 镜像的发行真源、清单完整性和下载校验要求。

## Requirements

### Requirement: GitHub Release 是客户端发行真源

每个正式版本 SHALL 通过 GitHub Release 发布受支持平台的 CLI、Windows Desktop、`SHA256SUMS` 和 `release-manifest.json`。公开源码仓库 MUST NOT 跟踪这些发行二进制。

#### Scenario: 发布正式版本
- **WHEN** 维护者推送符合发行规则的版本 tag
- **THEN** workflow 为受支持目标生成版本化资产、摘要文件和发行清单
- **AND** 所有资产来自同一已通过 CI 的 commit

### Requirement: 发行清单描述可验证资产

`release-manifest.json` MUST 为每个资产记录版本、目标平台、文件名、HTTPS 下载 URL、字节大小、SHA-256 和签名状态，并 MUST 通过发布前 schema 校验。

#### Scenario: 清单覆盖发行资产
- **WHEN** release workflow 准备发布资产
- **THEN** 每个 CLI 和 Desktop 资产在清单中恰有一个匹配条目
- **AND** 文件大小和 SHA-256 与实际资产一致

### Requirement: Server 镜像发布到 GHCR

正式 Server 镜像 SHALL 使用版本 tag 和不可变 commit SHA tag 推送到 GHCR。镜像 MUST NOT 包含 registration key 或跨平台 CLI/Desktop 发行二进制。

#### Scenario: 构建正式镜像
- **WHEN** release workflow 构建 Server 镜像
- **THEN** GHCR 中存在版本 tag 和 commit SHA tag
- **AND** 镜像检查未发现 registration key 或客户端发行二进制

### Requirement: 下载方验证发行完整性

CLI 和安装说明 MUST 在使用下载资产前校验发行清单中的 SHA-256；校验失败 MUST 中止替换或安装。

#### Scenario: CLI 下载摘要不匹配
- **WHEN** `localapp update` 下载的文件 SHA-256 与发行清单不一致
- **THEN** CLI 删除临时文件、保留当前可执行文件并返回完整性错误

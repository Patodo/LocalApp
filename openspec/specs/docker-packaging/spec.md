## Purpose

This spec describes Docker packaging requirements for LocalApp production images.

## Requirements

### Requirement: Docker 镜像包含 CLI 静态产物

生产 Docker 镜像 SHALL 只包含非敏感的 CLI 发行 fallback 元数据，不得包含 Windows、macOS 或 Linux CLI 二进制。容器内 Server SHALL 通过配置的发行清单提供版本发现和下载重定向。

#### Scenario: 镜像不包含客户端发行二进制
- **WHEN** 构建生产 Docker 镜像
- **THEN** 镜像文件系统不包含 `localapp-cli-*`、原生托盘安装包或历史发行压缩包

#### Scenario: 容器提供 CLI 版本发现
- **WHEN** 容器配置了有效的 `LOCALAPP_RELEASE_MANIFEST_URL`
- **THEN** `GET /api/cli/version` 返回经校验的远端发行元数据

### Requirement: Docker 构建前置产物要求

Docker 构建流程 SHALL 直接从已通过 CI 的源码构建 Server/Web 运行产物，不得要求仓库内预先生成 CLI release 二进制，也不得在 Node 运行镜像中安装 Rust toolchain。

#### Scenario: 从公开源码构建镜像
- **WHEN** 开发者从通过门禁的公开源码执行 Docker 构建
- **THEN** 构建不依赖 `packages/server/static/cli/{version}` 中的客户端二进制
- **AND** 运行镜像不包含 Rust toolchain

### Requirement: Docker 镜像不包含注册秘密

生产镜像 MUST NOT 复制或生成 `.registration-key`，也 MUST NOT 通过环境变量或镜像层提供共享客户端注册秘密。

#### Scenario: 检查正式镜像
- **WHEN** CI 扫描正式镜像的文件系统和历史层
- **THEN** 不存在 `.registration-key` 或 registration key 配置值

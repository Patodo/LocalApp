## ADDED Requirements

### Requirement: Docker 镜像包含 CLI 静态产物

生产 Docker 镜像 SHALL 包含 `packages/server/static/cli` 下的 CLI 版本清单和二进制产物。容器运行后，server 的 CLI 版本查询和下载接口 MUST 能读取镜像内的静态 CLI 目录。

#### Scenario: 镜像包含 versions.json

- **WHEN** 构建生产 Docker 镜像
- **THEN** 镜像内存在 server 可读取的 `static/cli/versions.json`
- **THEN** 容器内 `GET /api/cli/version` 可返回该版本清单

#### Scenario: 镜像包含当前平台 CLI 二进制

- **WHEN** 构建上下文中存在 `packages/server/static/cli/{version}/localapp-cli-{target}` 产物
- **THEN** Docker 镜像包含该版本目录和二进制文件
- **THEN** 容器内 `GET /api/cli/download` 可返回对应文件

### Requirement: Docker 构建前置产物要求

Docker 构建流程 SHALL 依赖构建上下文中已经生成的 CLI release 静态产物，不得在 Node 运行镜像内现场编译 Rust CLI。

#### Scenario: 构建前需要先发布 CLI 产物

- **WHEN** 开发者准备构建生产 Docker 镜像
- **THEN** 需要先执行 CLI release 发布步骤生成 `packages/server/static/cli/versions.json` 和至少一个平台二进制
- **THEN** Dockerfile 只复制这些产物，不安装 Rust toolchain

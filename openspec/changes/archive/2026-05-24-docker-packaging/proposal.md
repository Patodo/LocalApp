## Why

LocalApp Server 部署到内网环境时，目标机器可能没有 Node.js 和 npm。Docker 镜像将运行时和依赖全部打包，实现"拷贝即部署"，消除对目标环境的依赖。

## What Changes

- 添加 `Dockerfile`，构建 LocalApp Server 镜像
- 添加 `.dockerignore` 排除不需要的文件
- 添加 `docker-compose.yml` 用于本地开发和快速部署
- 添加构建和导出脚本，支持离线交付镜像

## Capabilities

### New Capabilities

（无新系统能力，纯打包部署）

### Modified Capabilities

（无系统能力变更）

## Impact

- **新增文件**: Dockerfile, .dockerignore, docker-compose.yml
- **无代码改动**: Server/CLI/SDK 代码不变
- **CI/CD**: 可选集成 Docker 构建步骤

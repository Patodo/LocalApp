## Context

LocalApp Server 是一个 Fastify (Node.js) 应用，依赖 sql.js (WASM SQLite)、@fastify/multipart、@fastify/cookie 等 npm 包。当前部署需要在目标机器上安装 Node.js 并运行 `pnpm install`。

目标：通过 Docker 镜像实现单文件交付，`docker load < image.tar` 即可运行。

## Goals / Non-Goals

**Goals:**
- Docker 镜像包含完整的 Node.js 运行时和应用代码
- 通过环境变量配置（PORT、JWT_SECRET、BOOTSTRAP_API_KEY 等）
- 挂载 volume 持久化数据目录
- 支持离线导出/导入镜像
- docker-compose.yml 提供开箱即用的本地体验

**Non-Goals:**
- 不做 CI/CD 集成（后续可加）
- 不做 Kubernetes 配置
- 不做多阶段构建优化以外的镜像体积优化
- 不改动任何应用代码

## Decisions

### Decision 1: 单阶段构建，基于 node:20-slim

```
FROM node:20-slim
COPY . /app
RUN corepack enable && pnpm install --frozen-lockfile
WORKDIR /app/packages/server
EXPOSE 3000
CMD ["npx", "tsx", "src/index.ts"]
```

选择 `node:20-slim`（~200MB）而非 Alpine（需要额外编译 sql.js WASM 依赖）。不过度优化镜像体积，优先保证兼容性。

如果需要更小的镜像，可以用多阶段构建只复制 `node_modules` 和源码到 `node:20-slim`，但不使用 Alpine。

### Decision 2: 数据目录通过 Volume 挂载

```
docker run -v /host/data:/app/data \
  -e BOOTSTRAP_API_KEY=xxx \
  -e JWT_SECRET=xxx \
  -e TEMPLATE_REPO_URL=xxx \
  -p 3000:3000 \
  localapp-server
```

数据持久化在宿主机，容器可随意重启/升级。

### Decision 3: 离线交付脚本

```bash
# 构建并导出
docker build -t localapp-server .
docker save localapp-server -o localapp-server.tar

# 内网加载
docker load -i localapp-server.tar
```

## Risks / Trade-offs

- **镜像体积** → node:20-slim + node_modules 约 400-500MB，可接受
- **sql.js WASM** → 需确认在 Debian slim 环境下正常运行（无需额外系统依赖）
- **文件上传大小** → Docker 默认限制不受影响，Fastify multipart 配置仍为 50MB

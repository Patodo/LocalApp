## Context

当前内容存储完全依赖 MinIO (S3-compatible)。`s3-client.ts` 在 `initS3Client` 时连接 MinIO，若连接失败则 `putObject`/`getObject` 抛出 `ECONNREFUSED`。`content.ts` 的 `handleContentUpload` 将异常透传为 500 响应。

本地开发环境没有运行 MinIO，导致内容上传完全不可用。目标是让平台在无外部依赖的情况下开箱即用，同时保留 S3 用于生产环境。

## Goals / Non-Goals

**Goals:**
- MinIO 不可用时自动降级为本地文件系统存储
- API 响应格式不变（`key` + `url` 结构）
- 读取端点 (`/api/content/:key`) 兼容两种存储后端
- 优先使用 MinIO（若可用），本地存储为降级方案

**Non-Goals:**
- 不实现存储后端的热切换（启动时确定，运行期间不变）
- 不提供存储后端选择配置（自动检测，不增加配置复杂度）
- 不迁移已有 S3 数据到本地

## Decisions

### Decision 1: 启动时检测 MinIO 可用性，选择存储后端

在 `initS3Client` 中捕获 `ensureBucket` 的连接错误，若 MinIO 不可达则降级为本地文件存储。通过模块级标志 (`useLocalStorage`) 控制后续调用走本地还是 S3 路径。

**理由**：启动时一次性决策，避免每次上传/读取都重试连接。简单可靠。

**备选方案**：每次请求时重试 S3 连接 → 放弃。延迟不可接受，且 MinIO 不会在运行期间凭空出现。

### Decision 2: 本地文件存储路径

本地文件存储在 `data/{userId}/{pageName}/content/{nanoid}.{ext}`，与页面版本数据并列。

```
data/
  testuser/
    localapp-bug2/
      versions/
      content/         ← 新增
        a1b2c3d4.png
```

**理由**：与现有目录结构一致，按用户和页面隔离，方便清理和管理。

**备选方案**：全局 `data/content/` 目录 → 放弃。缺少用户/页面隔离，清理复杂。

### Decision 3: 内容读取路由

本地存储模式下，`/serve/{userId}/{pageName}/api/content/{key}` 直接从文件系统读取，不经由 S3 SDK。需要在 `serve.ts` 或 `content.ts` 中根据存储模式分发。

**理由**：本地文件读取无需 S3 SDK 开销，`fs.readFileSync` 即可满足需求。

### Decision 4: 不更改 s3-client.ts 的公开 API

`putObject` / `getObject` 函数签名不变。内部根据存储模式标志分发到本地文件或 S3。`initS3Client` 改为 `initContentStorage`，名称更准确反映其职责。

## Risks / Trade-offs

- **风险**: 本地存储无副本、无冗余 → **缓解**: 平台定位为开发/小团队使用，本地文件存储满足需求。生产环境部署 MinIO 自动启用 S3。
- **风险**: 磁盘空间用尽 → **缓解**: 保留现有的 10MB 单文件限制，后续可加全局配额。

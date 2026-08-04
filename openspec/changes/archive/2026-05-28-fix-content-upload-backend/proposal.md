## Why

Content upload API (`POST /api/content/upload`) 依赖 MinIO (S3) 存储后端，但本地开发环境没有运行 MinIO，导致上传请求返回 `500 ECONNREFUSED`。这使得截图上传功能完全不可用，阻塞了所有依赖文件上传的应用场景（BUG 上报、表单附件等）。平台开发环境应开箱即用，不应要求外部服务。

## What Changes

- **新增本地文件存储回退**: 当 MinIO 不可用时，自动降级为本地文件系统存储（`data/{userId}/{pageName}/content/`），API 响应格式不变
- **保留 S3 存储能力**: MinIO/S3 配置不变，若 MinIO 可用则优先使用；本地存储作为降级方案
- **内容读取适配**: `/api/content/:key` 读取端点在两种存储模式下均正常工作

## Capabilities

### New Capabilities

- `local-content-storage`: 平台支持本地文件系统作为内容存储后端，MinIO 不可用时自动降级

### Modified Capabilities

<!-- 不涉及现有 spec 的需求变更 -->

## Impact

- `packages/server/src/lib/s3-client.ts` — 新增本地文件存储模块或降级逻辑
- `packages/server/src/routes/content.ts` — 可能调整读取路径以兼容本地文件
- `packages/server/src/routes/serve.ts` — 可能需要接管 `/api/content/:key` 的读取路由
- `data/` 目录结构 — 新增 `data/{userId}/{pageName}/content/` 目录

## Context

server-core 变更在 project-setup 建立的 monorepo 基础上，实现远程 HTTP 服务器的核心功能。服务器使用 Fastify 框架，需要处理 API Key 鉴权、文件上传（multipart）、页面服务（iframe + SPA fallback）和版本管理。

当前状态：`packages/server/` 仅有 Fastify 骨架（健康检查端点）。`packages/shared/` 已定义数据模型和 API 类型。

## Goals / Non-Goals

**Goals:**

- 完整的管理 API：上传、列出、删除、查看页面详情
- 安全的页面服务：iframe sandbox + CSP 头
- 版本管理：自动递增版本号，保留最近 10 版
- API Key 鉴权保护管理接口
- 支持 SPA 应用的客户端路由（fallback 到 index.html）

**Non-Goals:**

- 不实现 CRUD API（属于 server-crud 变更）
- 不实现 Schema 管理（属于 server-crud 变更）
- 不实现用户注册/管理界面（API Key 通过配置或 CLI 管理）
- 不实现 HTTPS（内网 HTTP）

## Decisions

### 1. API Key 存储在服务级 SQLite

使用 `meta.sqlite` 存储在数据根目录，包含 `api_keys` 表。

表结构：
```sql
CREATE TABLE api_keys (
  key TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_api_keys_user_id ON api_keys(user_id);
```

理由：
- 比配置文件灵活，可以动态增删 key
- 比每个页面 SQLite 独立，鉴权和数据存储分离
- SQLite 零配置，适合内部工具

### 2. 文件上传使用 @fastify/multipart

MCP client 通过 `POST /api/upload` 发送 multipart/form-data 请求。

请求格式：
- `userId`：从 API Key 推导（不在 body 中传递）
- `pageId`（可选）：form field
- `files`：多个 file parts

服务器收到后：
1. 验证 API Key → 获取 userId
2. 确定或生成 pageId（nanoid）
3. 创建新版本目录 `data/{userId}/{pageId}/versions/v{N}/`
4. 将所有文件写入版本目录
5. 更新 `meta.json`
6. 清理超出 10 版的旧版本

### 3. 页面访问使用双层路由

```
GET /{userId}/{pageId}          → iframe 包装页（带 sandbox + CSP）
GET /serve/{userId}/{pageId}/*  → 静态文件（实际页面内容，指向最新版本）
```

iframe 包装页由服务器动态生成 HTML，内嵌 sandbox iframe 指向 `/serve/` 路径。

SPA fallback：当请求的路径在版本目录中没有对应文件时，返回 `index.html`。

### 4. meta.json 结构

```json
{
  "pageId": "abc123",
  "userId": "user-1",
  "currentVersion": 3,
  "createdAt": "2026-05-21T10:00:00Z",
  "updatedAt": "2026-05-21T12:00:00Z",
  "versions": [
    { "version": 1, "createdAt": "...", "fileCount": 5, "totalSize": 12345 },
    { "version": 2, "createdAt": "...", "fileCount": 6, "totalSize": 15000 },
    { "version": 3, "createdAt": "...", "fileCount": 6, "totalSize": 15200 }
  ],
  "metadata": {}
}
```

版本信息记录在 meta.json 中，避免每次遍历文件系统。版本目录只在写入和清理时操作。

### 5. API Key 传递方式

通过 HTTP Header `X-API-Key` 传递。所有管理接口（`/api/upload`、`/api/pages/*`）需要此 header。

### 6. 代码组织

```
packages/server/src/
  index.ts              ← Fastify 入口，注册插件和路由
  plugins/
    auth.ts             ← API Key 鉴权 Fastify 插件
    storage.ts          ← 文件系统存储操作插件
  routes/
    upload.ts           ← POST /api/upload
    pages.ts            ← GET/DELETE /api/pages/*
    serve.ts            ← GET /{userId}/{pageId} 和 GET /serve/*
  lib/
    meta-sqlite.ts      ← meta.sqlite 操作封装
    file-utils.ts       ← 文件操作工具函数
```

Fastify 插件体系封装鉴权和存储逻辑，路由文件只关注 HTTP 处理。

## Risks / Trade-offs

- **[并发写入 meta.json]** → 使用文件锁或写入时加内存锁。内部工具并发量低，简单的写入队列即可。
- **[大文件上传内存占用]** → @fastify/multipart 默认使用流式处理，不会将整个文件加载到内存。需确保配置 `limits.fileSize` 为 50MB。
- **[版本清理时文件正在被访问]** → 清理时只删除最旧版本，当前服务的版本不会被清理。使用 `fastify-static` 的缓存机制避免已删除文件的问题。
- **[meta.sqlite 单点]** → SQLite 单写者模型适合内部工具。如果未来需要多实例部署，需要迁移到 PostgreSQL。

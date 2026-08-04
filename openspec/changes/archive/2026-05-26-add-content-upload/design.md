## Context

LocalApp 当前仅支持开发者通过 CLI 上传整个应用包（部署用途），终端用户无法在前端应用中上传图片等内容。现有文件上传（`POST /api/upload`）面向应用部署，使用本地文件系统 + 版本化目录结构，与用户内容上传的语义完全不同。

服务端基于 Fastify，已有完整的访问控制体系（`checkPageAccess`、`checkRouteAccess`），可复用。存储层无抽象，直接使用 `fs` 模块。前端通过 `@localapp/client` SDK 的 CRUD hooks 与平台交互。

用户内容上传需要独立于部署流程，使用 MinIO（S3 兼容）作为对象存储后端。

## Goals / Non-Goals

**Goals:**
- 提供用户内容上传 API，支持图片文件（png、jpg、jpeg、gif、webp、svg）上传
- 集成 MinIO 作为对象存储后端，使用 `@aws-sdk/client-s3` SDK
- 复用现有 pageAccess 机制控制内容的访问权限
- 在 Client SDK 中提供 `useUpload` hook，方便前端应用集成
- 更新 init-repo 模板 skills，指导 AI Agent 开发带图片上传的应用

**Non-Goals:**
- 不替换现有应用部署上传流程
- 不实现文件删除 API（后续迭代）
- 不支持视频、文档等非图片类型（后续迭代）
- 不实现客户端直传（presigned URL）模式
- 不修改现有 access-control.ts 的核心逻辑

## Decisions

### Decision 1: 新增独立的内容 API 路由

**选择**: 新增 `/serve/{userId}/{name}/api/content/upload` 和 `/serve/{userId}/{name}/api/content/{key}` 路由

**替代方案**:
- 修改现有 upload.ts：语义不匹配，部署上传是整个应用包版本化，用户内容是单文件附加到数据记录
- 在 CRUD API 中嵌入文件处理：CRUD 负责结构化数据，文件是二进制内容，职责不同

**理由**: 新旧完全解耦，零风险影响现有功能。路由模式沿用 `/serve/{userId}/{name}/api/` 前缀，与 CRUD API 保持一致的路径风格。

### Decision 2: MinIO 单 Bucket + 路径隔离

**选择**: 一个 bucket `localapp-content`，按 `{userId}/{pageName}/{contentKey}.{ext}` 组织

**替代方案**:
- 每用户一个 bucket：S3 有 bucket 数量上限（AWS 默认 100），管理复杂
- 数据库存储 BLOB：SQLite 不适合存二进制大对象

**理由**: 路径结构与现有 `data/{userId}/{pageName}/` 一致，自然直观。单 bucket 管理简单，无数量限制。

### Decision 3: 使用 @aws-sdk/client-s3

**选择**: 使用 AWS S3 SDK 连接 MinIO

**替代方案**:
- `minio` 专用 SDK：API 不通用，将来切 AWS 需重写

**理由**: S3 兼容协议是行业标准，MinIO 完全兼容。将来迁移到 AWS S3、Cloudflare R2 等只需改 endpoint 配置。

### Decision 4: Server 代理模式读取内容

**选择**: 前端请求 → Server 校验访问权限 → 从 MinIO 读取 → 返回图片

**替代方案**:
- Presigned URL 直传：MinIO 端口暴露给外部，需要额外配置 CORS 和访问策略
- Nginx 代理：引入额外组件

**理由**: 访问控制逻辑在 Server 内闭环，MinIO 不对外暴露。前端使用与 CRUD API 相同的 basePath 模式，保持一致性。

### Decision 5: Server 配置扩展

新增配置项（config.toml 或环境变量）：
- `minioEndpoint`: MinIO 地址（默认 `localhost:9000`）
- `minioAccessKey`: 访问密钥
- `minioSecretKey`: 密钥
- `minioBucket`: bucket 名称（默认 `localapp-content`）

### Decision 6: 文件大小和类型限制

- 单文件最大 10MB
- 允许类型：png、jpg、jpeg、gif、webp、svg
- Content-Key 使用 nanoid 生成，避免文件名冲突和路径遍历

## Risks / Trade-offs

**[MinIO 成为必需依赖]** → Mitigation: docker-compose 中包含 MinIO，开发环境一键启动。未来可考虑 local filesystem fallback 用于开发。

**[Server 代理增加延迟]** → Mitigation: 图片经 Server 中转增加一跳。可接受，因为访问控制需要在校验后才能返回数据。后续如需优化可引入 presigned URL + 短期 token。

**[MinIO 存储无上限]** → Mitigation: 当前阶段不设用户内容存储配额。后续可按 bucket prefix 统计用量并设限。

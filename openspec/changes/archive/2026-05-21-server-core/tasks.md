## 1. 基础设施

- [x] 1.1 创建 `packages/server/src/lib/meta-sqlite.ts`：封装 meta.sqlite 初始化和 api_keys 表 CRUD
- [x] 1.2 创建 `packages/server/src/plugins/auth.ts`：Fastify 鉴权插件，从 X-API-Key header 查询 userId
- [x] 1.3 创建 `packages/server/src/plugins/storage.ts`：Fastify 存储插件，封装文件系统操作（数据目录初始化、版本目录创建、文件写入、目录删除）
- [x] 1.4 创建 `packages/server/src/lib/file-utils.ts`：工具函数（计算目录大小、统计文件数、递归删除目录）

## 2. API Key 管理

- [x] 2.1 创建 `packages/server/src/routes/keys.ts`：POST /api/keys（创建 key）、GET /api/keys（列出 key）
- [x] 2.2 在 index.ts 中注册 auth 插件和 keys 路由
- [x] 2.3 手动测试：启动服务器，创建 API Key，验证鉴权中间件拦截无效请求

## 3. 文件上传

- [x] 3.1 创建 `packages/server/src/routes/upload.ts`：POST /api/upload，接收 multipart，写入版本目录，更新 meta.json
- [x] 3.2 在 index.ts 中注册 @fastify/multipart 和 upload 路由
- [x] 3.3 实现存储限制检查（50MB 单次上传、500MB 用户总量）
- [x] 3.4 手动测试：通过 curl 上传文件，验证文件写入和 meta.json 更新

## 4. 页面服务

- [x] 4.1 创建 `packages/server/src/routes/serve.ts`：GET /{userId}/{pageId}（iframe 包装页）和 GET /serve/{userId}/{pageId}/*（静态文件 + SPA fallback）
- [x] 4.2 在 index.ts 中注册 serve 路由
- [x] 4.3 实现 CSP 安全头设置
- [x] 4.4 手动测试：浏览器访问页面链接，验证 iframe 加载和静态文件服务

## 5. 页面管理接口

- [x] 5.1 在 `packages/server/src/routes/pages.ts` 中实现 GET /api/pages（列表）、GET /api/pages/:pageId（详情）、DELETE /api/pages/:pageId（删除）
- [x] 5.2 实现用户权限校验：只能操作自己的页面
- [x] 5.3 在 index.ts 中注册 pages 路由
- [x] 5.4 手动测试：通过 API Key 调用各管理接口

## 6. 版本管理

- [x] 6.1 实现版本自动递增逻辑（写入 upload 路由中）
- [x] 6.2 实现版本清理逻辑：超过 10 版时删除最旧版本
- [x] 6.3 手动测试：连续上传 11 次，验证 v1 被清理

## 7. 集成验证

- [x] 7.1 端到端测试：创建 Key → 上传页面 → 访问页面 → 更新页面（新版本）→ 验证版本 → 删除页面
- [x] 7.2 验证 SPA fallback：上传 SPA 应用，直接访问子路由 URL
- [x] 7.3 验证安全隔离：检查 iframe sandbox 属性和 CSP 头

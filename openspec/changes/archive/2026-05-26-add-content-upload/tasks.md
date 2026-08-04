## 1. 基础设施

- [x] 1.1 docker-compose.yml 新增 MinIO 服务（API :9000、Console :9001、named volume、默认凭证）
- [x] 1.2 Server 安装 `@aws-sdk/client-s3` 依赖
- [x] 1.3 Server config 扩展 MinIO 配置项（endpoint、accessKey、secretKey、bucket），支持 config.toml 和环境变量

## 2. S3 客户端初始化

- [x] 2.1 创建 `packages/server/src/lib/s3-client.ts`，封装 S3 客户端创建、bucket 自动创建、PutObject/GetObject 操作
- [x] 2.2 编写 s3-client.ts 单元测试（mock S3 SDK，测试初始化、上传、读取）
- [x] 2.3 Server 启动时初始化 S3 客户端（在 index.ts 或 plugin 中注册）

## 3. 内容上传 API

- [x] 3.1 创建 `packages/server/src/routes/content.ts`，实现 `POST /serve/{userId}/{name}/api/content/upload` 路由
- [x] 3.2 实现文件类型校验（png/jpg/jpeg/gif/webp/svg）和大小限制（10MB）
- [x] 3.3 实现 checkPageAccess 访问控制校验
- [x] 3.4 实现文件存储到 MinIO（路径 `{userId}/{name}/{nanoid}.{ext}`）并返回 `{ key, url }`
- [x] 3.5 编写上传 API 测试（成功上传、无文件、类型不支持、大小超限、权限拒绝）

## 4. 内容读取 API

- [x] 4.1 在 content.ts 中实现 `GET /serve/{userId}/{name}/api/content/{key}` 路由
- [x] 4.2 实现 checkPageAccess 访问控制校验后从 MinIO 读取文件
- [x] 4.3 实现 Content-Type 根据 key 扩展名自动设置
- [x] 4.4 编写读取 API 测试（成功读取、文件不存在、权限拒绝、public 页面无认证访问）

## 5. 路由注册

- [x] 5.1 在 serveRoutes 中注册内容 API 路由，确保路径匹配优先于 CRUD `{resource}/{id}` 模式
- [x] 5.2 验证现有 CRUD API 路由不受影响

## 6. Client SDK

- [x] 6.1 在 `packages/client/src/types.ts` 中新增 `UploadResult` 类型（`{ key: string; url: string }`）
- [x] 6.2 在 `packages/client/src/client.ts` 中新增 `upload(file: File)` 方法（POST multipart 到 `{basePath}/content/upload`）
- [x] 6.3 在 `packages/client/src/react.ts` 中新增 `useUpload()` Hook（返回 `{ upload, loading, error }`）
- [x] 6.4 在 `packages/client/src/index.ts` 中导出 `useUpload` 和 `UploadResult`
- [x] 6.5 编写 useUpload hook 测试（mock fetch，测试成功上传、loading 状态、错误处理）

## 7. Init-repo 模板更新

- [x] 7.1 ~~执行 `pnpm sync:sdk`~~ 已在 sdk-auto-sync 变更中移除，SDK 代码直接在 init-repo 中更新
- [x] 7.2 创建 `init-repo/.claude/skills/localapp-upload.md`，包含 useUpload 用法、文件类型限制、表单集成示例

## 8. 集成验证

- [x] 8.1 启动 MinIO + Server，手动测试上传/读取完整流程
- [x] 8.2 验证访问控制：public 页面无需认证可读、authenticated 页面未登录拒绝、owner 页面非 owner 拒绝
- [x] 8.3 验证现有部署上传和 CRUD API 功能未受影响

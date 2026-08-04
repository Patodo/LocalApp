## Why

当前 LocalApp 的所有管理操作仅通过 API Key 鉴权，而页面访问和 CRUD API 完全公开——任何人只要知道 URL 就能读写数据。作为公司内网平台，需要一套全局登录体系，让用户访问任何应用时自带身份，并允许应用所有者按需控制访问权限（只读、需登录、仅限特定用户等）。

## What Changes

- 新增用户注册 / 登录接口（用户名 + 密码），签发 JWT 并通过 HttpOnly cookie 维持会话
- 新增 `GET /api/me` 接口，应用可查询当前访客身份
- 页面 iframe 外层进化为平台壳，显示登录状态和用户信息
- meta.sqlite 新增 `users` 表，存储用户账号信息
- 新增双层访问控制模型：
  - **页面级**：控制谁能看到这个应用（public / authenticated / owner / acl）
  - **路由级**：控制每个资源（schema）的每个 CRUD 操作分别允许谁执行
- 所有访问策略默认 `public`，向后兼容，现有行为不受影响
- 预留 OAuth 接口（users 表加 provider 字段），本期不实现

## Capabilities

### New Capabilities

- `user-auth`: 用户注册、登录、会话管理（JWT cookie），以及 `GET /api/me` 访客身份查询接口
- `access-control`: 双层访问控制——页面级和路由级（per-schema, per-method），支持 public / authenticated / owner / acl 四种粒度

### Modified Capabilities

- `page-serving`: iframe 外层页面进化为平台壳，读取 session cookie 显示登录状态；静态文件服务受页面级访问控制约束
- `crud-api`: CRUD 请求读取 session cookie 获取 visitorId，执行前检查路由级访问策略
- `api-key-auth`: 与 session 认证并行存在；meta.sqlite 新增 users 表；api_keys.user_id 关联到 users.id

## Impact

- **packages/server**：新增用户管理路由、session 中间件、访问控制检查逻辑；serve 路由和 CRUD handler 增加 identity 提取和权限校验
- **packages/shared**：新增 User 类型、AccessPolicy 类型、Login/Register API 类型定义；Page 和 DataSchema 类型扩展访问策略字段
- **meta.sqlite**：新增 `users` 表；`api_keys` 表保持不变但语义上关联 users
- **meta.json**：Page 元数据扩展 `pageAccess` 字段；Schema 扩展 `routeAccess` 字段
- **新增依赖**：bcrypt（密码哈希）、jsonwebtoken（JWT 签发验证）

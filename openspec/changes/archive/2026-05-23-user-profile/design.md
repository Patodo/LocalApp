## Context

LocalApp 当前的用户系统仅支持注册、登录、登出，`meta.sqlite` 的 `users` 表包含 `id`、`name`、`password`、`provider`、`role`、`created_at` 字段。用户创建后无法修改任何个人信息。

前端方面，Admin Panel（`packages/admin/`）是一个 React SPA，通过 `/admin` 访问，仅管理员角色可用。用户页面（`/serve/{userId}/{pageName}`）的导航栏由 `serve.ts` 中的 `buildPlatformShell` 函数硬编码生成。不存在面向普通用户的设置或资料页面。

文件上传方面，`@fastify/multipart` 已注册，`upload.ts` 中有现成的 multipart 处理模式（50MB 限制、用户存储配额）。

## Goals / Non-Goals

**Goals:**
- 所有已登录用户（admin 和普通用户）都能自助修改昵称、简介、密码、头像
- Profile 前端作为独立 SPA 存在于 `/profile` 路径，不嵌入 Admin Panel
- 头像文件独立存储，不占用页面版本系统的空间和配额
- 数据库改动向后兼容（新增列均有默认值 NULL）
- 引入 Playwright 作为项目级 UI 自动化测试框架，本次覆盖 Profile SPA 和登录/注册流程

**Non-Goals:**
- 不支持 OAuth 第三方头像导入
- 不支持邮箱、手机号等联系方式
- 不支持管理员编辑其他用户的个人资料（管理员只能查看/删除用户）
- 不给普通用户提供独立的管理面板（只提供 Profile 页面）
- 不给 Profile SPA 做独立的部署流程（随 server 一起构建和静态服务）

## Decisions

### 1. Profile SPA 独立于 Admin Panel

**选择：** 新建 `packages/profile/` 作为独立 React SPA，通过 `/profile` 路径提供。

**替代方案：** 在 `packages/admin/` 内添加 Profile 页面，复用 Admin 构建流程。

**理由：** Admin Panel 受 admin 角色保护（`admin-serve.ts` 检查角色），普通用户无法访问。将 Profile 嵌入 Admin 需要绕过角色检查或开放部分 Admin 路由，增加复杂度和安全风险。独立 SPA 更干净，访问控制独立。

### 2. 后端 API 作为平台级端点

**选择：** 新增 `/api/me/profile`、`/api/me/password`、`/api/me/avatar` 端点，放在新文件 `routes/profile.ts`，通过 session 认证（非 API Key）。

**理由：** 个人资料操作涉及密码验证和文件上传，必须是平台级 API（访问 `meta.sqlite`），不能是 page 级 CRUD。`/api/me/` 前缀与现有 `/api/me` 保持一致的命名空间。要求 session 认证是因为 API Key 是长期凭证，不适合做密码修改这类敏感操作。

### 3. 头像存储方案

**选择：** 头像文件存储在 `{DATA_DIR}/avatars/{userId}.{ext}`，数据库存相对路径。

**替代方案：**
- 存入 page 级静态文件 → 头像不属于任何页面，语义不对
- 存入 admin static → admin static 是构建产物，会被覆盖
- 纯数据库 base64 → 增加数据库体积，不适合频繁读取

**理由：** 独立目录、独立命名、随 DATA_DIR 管理。数据库只存路径字符串，读取时直接返回文件流。限制 2MB、仅 jpg/png/webp 格式。

### 4. 数据库 Migration 方式

**选择：** 沿用现有的 `PRAGMA table_info` + `ALTER TABLE ADD COLUMN` 模式。

**理由：** 项目没有 migration 框架，`meta-sqlite.ts` 中已有的 role 列 migration 就是这个模式。新增 3 个可空列，向后兼容，无需数据迁移。

### 5. Profile 页面服务方式

**选择：** 在 `admin-serve.ts` 中添加 `/profile` 路由，检查已登录（非 admin 专用），服务构建后的静态文件。复用 Admin 的静态文件服务逻辑。

**理由：** Admin 的静态服务模式（读取 index.html → 注入 `window.__USER__` → 返回）已经很成熟，Profile 需要类似的用户信息注入。复用同一文件避免重复逻辑。`packages/profile/` 的 vite build 输出到 `packages/server/static/profile/`。

## Risks / Trade-offs

- **[头像磁盘空间]** → 单个头像限 2MB，理论上限可控。暂不做清理策略，与 DATA_DIR 同生命周期。
- **[旧密码验证绕过]** → OAuth 用户（provider 非 local）没有密码，不允许使用密码修改功能。API 返回明确错误。
- **[密码修改后 session 不失效]** → 用户修改密码后当前 JWT 仍有效（JWT 无状态）。这是可接受的行为，与大多数平台一致。如需强制重登录，需要引入 token 黑名单，复杂度远超当前需求。
- **[Profile SPA 构建耦合]** → Profile 构建产物放入 `static/profile/`，随 server 部署。无法独立热更新 Profile UI。但与 Admin Panel 一致的部署模式，运维简单。

### 6. Playwright UI 测试框架

**选择：** 引入 Playwright 作为项目级 UI 自动化测试工具，放在 `packages/server/tests/e2e-ui/` 目录。

**替代方案：**
- Cypress → 需要后台进程、不支持多浏览器并行、对 CI 环境要求更高
- vitest + jsdom → 纯单元测试，无法测真实浏览器交互
- Puppeteer → 底层 API，缺少断言和测试组织能力

**理由：** Playwright 是当前业界主流的 E2E 测试框架，支持多浏览器、自动等待、网络拦截，开箱即用。配置模式：测试前启动真实 server（复用 `createTestServer`），Playwright 连接浏览器执行交互。

**测试范围：**
- Profile SPA：登录后访问、编辑昵称/简介、上传头像、修改密码
- 登录/注册页面：表单交互、错误提示、跳转
- 用户页面导航栏：头像展示、Profile 链接跳转

**测试架构：**
- `playwright.config.ts` 放在项目根目录
- 测试文件放在 `packages/server/tests/e2e-ui/`
- 测试 helper：启动 server → 获取 baseUrl → Playwright 连接
- CI 集成：`npx playwright test`，使用 headed 模式的 Chromium

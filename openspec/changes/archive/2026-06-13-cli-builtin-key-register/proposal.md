## Why

当前 `auth-registration-control` 变更虽然实现了 CLI 静默注册，但留下两个摩擦点：1) `registration_key` 是可配项，`.env.example` 未暴露入口，部署者不知道要配；2) CLI 必须显式传 `--registration-key`，新员工首次使用时无法零参数完成。需要将 key 从"可配凭证"升级为"构建时锁定的内置标识"，同时关闭浏览器注册通道，让 CLI 真正零摩擦接入。

## What Changes

- **移除浏览器注册通道** **(BREAKING)**：删除 `POST /api/auth/register` 端点、`/register` 前端页面及 3 处导航链接
- **新增 CLI 专用注册端点**：`POST /api/auth/cli-register`，只接受内置 key 认证，校验 `auto_register_pattern` 后创建用户并返回 API Key
- **内置 key 机制**：新增共享文件 `packages/shared/.registration-key`（gitignored）作为唯一真相源；`pnpm setup` 生成随机 key；CLI 编译时通过 `build.rs` 读取并 `env!()` 注入 binary；server 启动时读取该文件；Docker 打包时 COPY 进镜像
- **移除可配 key** **(BREAKING)**：删除 `auth.registration_key` 和 `auth.allow_register` 两个配置项，key 不再由部署者控制
- **CLI login 零参数化** **(BREAKING)**：移除 `--registration-key` 参数，`localapp login` 自动使用内置 key + OS 用户名尝试注册，失败回退手动输入 API Key
- **保留**：`auth.auto_register_pattern`（默认 `^[a-z][a-z0-9_]*$`，可配）、`auth.admin_default_password`

## Capabilities

### New Capabilities

无新增能力。所有变更覆盖在现有能力范围内。

### Modified Capabilities

- `user-auth`：移除公开注册端点，新增 CLI 专用注册端点；注册不再受 `allow_register` 开关控制，改为内置 key 鉴权
- `server-config`：移除 `allow_register` 和 `registration_key` 两个配置项；新增 `registration_key` 从共享文件读取的加载逻辑
- `cli-tool`：`login` 命令移除 `--registration-key` 参数，改为使用编译时注入的内置 key 自动注册

## Impact

- **Server 代码**：`config.ts`（-2 字段，+共享文件读取）、`auth.ts`（移除 `/register`，新增 `/cli-register`）、`serve.ts`（移除 `/register` 页面路由）
- **CLI 代码**：`main.rs`（移除 `--registration-key` 参数）、`login.rs`（使用内置 key 自动注册）、新增 `build.rs`（编译时读取共享文件）
- **Web 代码**：移除 `app/(auth)/register/page.tsx`，移除 `login/page.tsx`、`navbar.tsx`、首页中 3 处 `/register` 链接
- **构建/工具链**：新增 `packages/shared/.registration-key` 文件（gitignored）、`.gitignore` 更新、`pnpm setup` 脚本生成 key、Dockerfile COPY key 文件
- **测试**：30+ 个集成测试文件中的 `POST /api/auth/register` 调用迁移到 admin API 或 `cli-register` 端点；`register-control.test.ts` 重写或删除
- **API 行为**：`POST /api/auth/register` 不再存在（404）；`POST /api/auth/cli-register` 仅接受内置 key
- **配置**：`config.toml` 中 `[auth]` 下 `allow_register` 和 `registration_key` 字段废弃（读取时忽略），新增共享文件作为 key 来源

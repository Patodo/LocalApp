## Why

当前认证体系存在两个问题：1) 注册端点完全开放，任何人可自行注册；2) Admin 用户由 bootstrap 创建但无密码，无法通过浏览器登录。需要关闭公开注册入口、为 Admin 提供默认密码并强制首次改密，同时为 CLI 提供基于工号格式的静默注册能力，让员工零摩擦接入。

## What Changes

- **注册开关**：新增 `allow_register` 配置项（默认 `false`），关闭时浏览器注册接口返回 403
- **CLI 静默注册**：注册接口支持 `X-Registration-Key` 头认证，配合 `auto_register_pattern` 正则校验用户名格式，通过后自动创建用户并返回 API Key
- **Admin 默认密码**：Admin 用户改为 `local` provider，使用可配置的默认密码（`localadmin`），启动时设置 `must_change_password=1`
- **Provider 清理**：移除 `admin.ts` 和 `profile.ts` 中对 `provider` 字段的权限检查，`findUserByName` 去掉 `provider='local'` 过滤，字段保留为 OAuth 预留

## Capabilities

### New Capabilities

无新增能力。变更覆盖的认证行为均在现有 `user-auth` 能力范围内。

### Modified Capabilities

- `user-auth`：注册端点增加开关控制和 CLI 静默注册模式；Admin bootstrap 改为 local provider + 默认密码 + 强制改密；移除 provider 权限检查
- `api-key-auth`：注册成功时可为新用户同时生成 API Key（CLI 静默注册场景）
- `server-config`：新增 `allow_register`、`admin_default_password`、`registration_key`、`auto_register_pattern` 四个配置项

## Impact

- **Server 代码**：`config.ts`（+4 字段）、`meta-sqlite.ts`（bootstrap 逻辑）、`auth.ts`（注册路由改造）、`admin.ts`（删 provider 检查）、`profile.ts`（删 provider 检查）
- **CLI 代码**：`login.rs`（新增 OS 用户名获取 + 自动注册流程）、`client.rs`（支持 registration key 头）
- **API 行为**：`POST /api/auth/register` 新增 `X-Registration-Key` 头和条件放行逻辑；无 `allow_register` 和 `registration_key` 时注册拒绝
- **数据库**：无 schema 变更，`provider` 字段保留
- **配置**：`config.toml` 新增 `[auth]` 下四个可选配置项，均有环境变量覆盖

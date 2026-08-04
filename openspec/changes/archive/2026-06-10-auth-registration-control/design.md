## Context

当前认证体系有三个问题需要解决：

1. **注册无限制**：`POST /api/auth/register` 对任何人开放，无法控制用户来源
2. **Admin 无法浏览器登录**：bootstrap 创建的 admin 用户 `provider='system'`、密码为空，`findUserByName` 仅查 `provider='local'`，导致浏览器登录完全不可用
3. **新员工接入成本高**：需要 admin 手动创建用户和 API Key，再分发给员工

现有基础设施可复用：`must_change_password` 字段已存在、`POST /api/auth/force-change-password` 流程已完整、API Key 管理接口已可用。

## Goals / Non-Goals

**Goals:**
- Admin 可通过浏览器登录（默认密码 `localadmin`），首次登录强制改密
- 关闭公开注册，外部人员无法自行创建账号
- CLI 在 `localapp login` 时，若 OS 用户名匹配工号格式，自动完成注册 + 获取 API Key
- 配置驱动，所有行为通过 `config.toml` / 环境变量控制

**Non-Goals:**
- 不实现 OAuth / SSO / LDAP 等外部认证集成（`provider` 字段保留供未来使用）
- 不实现邀请码机制
- 不修改前端注册页面 UI（开关关闭时后端返回 403 即可）
- 不实现注册审批流程

## Decisions

### D1: 注册开关 — 配置项而非路由移除

新增 `allow_register` 布尔配置（默认 `false`）。在 `POST /register` 路由内检查，关闭时返回 403。

**替代方案**：直接删除注册路由 → 部署后无法重新开启，不够灵活。

### D2: CLI 静默注册 — 复用注册端点 + registration_key

不创建新的注册接口。在现有 `POST /register` 路由中，通过 `X-Registration-Key` 头区分来源：
- 无 key → 走 `allow_register` 开关逻辑（浏览器注册）
- 有 key 且匹配 `registration_key` 配置 → 校验用户名匹配 `auto_register_pattern` → 允许注册

注册成功时额外生成 API Key 一并返回，CLI 直接保存。

**替代方案**：独立的 `POST /api/auth/auto-register` 端点 → 多一个接口维护，且逻辑与注册高度重复。

### D3: Admin 初始化 — 改用 local provider

Bootstrap 时 admin 用户改为 `provider='local'`、密码为 `bcrypt(admin_default_password)`、`must_change_password=1`。利用现有的强制改密流程完成首次密码设置。

**替代方案**：保持 `system` provider，在 login 路由中特殊处理 → 增加特殊逻辑，违背"所有用户统一流程"原则。

### D4: Provider 字段 — 保留但不再做权限区分

移除 `admin.ts`、`profile.ts` 中对 `provider` 的检查，`findUserByName` 去掉 `AND provider='local'` 过滤。字段保留在 schema 中，默认值为 `'local'`，为未来 OAuth 集成预留。

### D5: CLI 静默注册的默认密码

CLI 注册的用户使用固定默认密码 `localapp`，`must_change_password=1`。CLI 场景下用户通过 API Key 认证，密码仅用于首次浏览器登录时触发改密。

### D6: 配置项汇总

| 配置项 | config.toml 键 | 环境变量 | 默认值 |
|--------|----------------|---------|--------|
| 注册开关 | `auth.allow_register` | `ALLOW_REGISTER` | `false` |
| Admin 默认密码 | `auth.admin_default_password` | `ADMIN_DEFAULT_PASSWORD` | `localadmin` |
| 注册凭证 | `auth.registration_key` | `REGISTRATION_KEY` | 空（不启用） |
| 工号正则 | `auth.auto_register_pattern` | `AUTO_REGISTER_PATTERN` | `^[a-z][a-z0-9_]*$` |

## Risks / Trade-offs

- **[registration_key 泄露]** → 任何持有 key 的人可注册匹配格式的用户名。缓解：key 仅限注册，无 admin 权限；可通过更换 key 失效。
- **[admin 默认密码可预测]** → 如果部署者不修改 `localadmin`，攻击者可尝试登录。缓解：`must_change_password=1` 强制首次改密；建议在文档中强调生产环境修改。
- **[OS 用户名不可靠]** → 共享机器上多人使用同一 OS 账户时，CLI 会用同一个用户名注册。缓解：这是预期行为，企业场景下 OS 账户 = 人员身份。
- **[auto_register_pattern 过宽]** → 正则写得宽松可能导致不期望的用户名通过。缓解：正则可配，部署者自行控制。

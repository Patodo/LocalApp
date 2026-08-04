## Context

LocalApp 当前有两套完全分离的访问模式：管理侧通过 API Key（CLI 使用）鉴权，访问侧（页面浏览 + CRUD）完全公开。系统没有用户账号概念——`userId` 只是一个从 API Key 映射出来的字符串，直接用作文件目录名。

随着平台在内网推广，需要：
- 访问应用时携带身份（知道"谁在看"）
- 应用所有者能控制谁能看到应用、谁能操作数据
- 匿名访问仍然可用（公共页面）

## Goals / Non-Goals

**Goals:**

- 用户注册 / 登录（用户名 + 密码），JWT 会话通过 HttpOnly cookie 维持
- 应用可通过 `GET /api/me` 获取当前访客身份
- 页面 iframe 外层进化为平台壳，显示登录状态
- 双层访问控制：页面级（看得到吗？）+ 路由级（能做什么操作？）
- 所有策略默认 public，零破坏性升级
- 预留 OAuth 扩展点

**Non-Goals:**

- 本期不实现 OAuth（GitHub / Google 等），仅预留数据模型
- 不做多租户 / 团队 / 组织管理
- 不做用户管理后台（管理员面板）
- 不改 CLI 工具——CLI 继续使用 API Key
- 不做邮箱验证、密码找回等流程

## Decisions

### Decision 1: JWT in HttpOnly Cookie（而非 Session 表）

**选择**: 无状态 JWT，存在 HttpOnly + SameSite=Lax 的 cookie 中。

**理由**: 公司内网项目，不需要主动失效 session 的场景。无状态意味着不需要 session 存储表，meta.sqlite 保持轻量。

**备选方案**: 服务端 session 表（支持主动踢人），但增加了复杂度，当前阶段不需要。

### Decision 2: 双层访问控制模型

**选择**: 页面级 + 路由级（per-schema per-method），两层独立，可单独使用。

```
页面级（pageAccess）:
  public / authenticated / owner / acl

路由级（routeAccess，挂在 DataSchema 上）:
  read: public / authenticated / owner / acl
  create: public / authenticated / owner / acl
  update: public / authenticated / owner / acl
  delete: public / authenticated / owner / acl
```

**理由**: 不同粒度满足不同场景——简单的应用只配页面级，复杂的应用可以精细到"谁可以删除"。两层独立，不配就默认 public。

**备选方案**: RBAC（角色模型），但当前阶段角色只有 owner / visitor / acl-member，引入角色体系过度设计。

### Decision 3: 平台壳 + iframe 保留

**选择**: 保留 iframe 架构，外层页面从空壳进化为平台壳（导航栏 + 登录状态）。

**理由**: iframe 提供了应用隔离（CSS/JS 不冲突），外层页面负责平台级 UI（登录/注册/导航）。应用通过 `GET /api/me`（cookie 自动带）获取访客身份，不需要平台壳注入任何内容到 iframe 内部。

**备选方案**: 去掉 iframe，直接服务应用并在外层注入平台脚本。缺点是应用 CSS/JS 可能与平台 UI 冲突。

### Decision 4: users 表加入 meta.sqlite

**选择**: 在现有 meta.sqlite 中新增 `users` 表，而非新建数据库。

**理由**: meta.sqlite 已经是项目级数据库（存 API Key），用户数据量小（内网），单库管理更简单。

**Schema**:
```sql
CREATE TABLE users (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  password   TEXT NOT NULL,    -- bcrypt hash
  provider   TEXT DEFAULT 'local',  -- 预留 OAuth: 'local' | 'github' | 'google'
  created_at TEXT DEFAULT (datetime('now'))
);
```

### Decision 5: 身份提取中间件

**选择**: 在 serve 路由组之前注册一个 session 解析 hook，从 cookie 提取 visitorId。不强制登录（visitorId 可为 null）。

**理由**: serve 路由需要知道访客身份来做访问控制，但不应强制所有请求都登录。hook 提取身份后设 `req.visitorId`，后续访问控制逻辑据此判断。

## Risks / Trade-offs

**JWT 无法主动失效** → 内网场景可接受。若未来需要，可加一个 lightweight 黑名单（Redis 或 meta.sqlite 表）。当前不做。

**iframe cookie 限制** → SameSite=Lax 在同域 iframe 中正常工作。若未来引入自定义域名，需要额外处理（当前不涉及）。

**密码存储安全性** → 使用 bcrypt，salt rounds=10。内网项目足够，生产环境应考虑更高 rounds 或 argon2。

**meta.sqlite 并发** → sql.js 是单进程内存数据库，每次写操作 load-modify-save。用户注册不会高频，性能可接受。

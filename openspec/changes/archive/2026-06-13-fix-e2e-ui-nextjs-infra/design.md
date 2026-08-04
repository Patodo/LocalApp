## Context

`e2e-ui` 测试套件位于 `packages/server/tests/e2e-ui/`，由 `playwright.config.ts` 驱动，baseURL 由 `helpers.ts` 启动的临时 fastify server 提供。

历史上 admin/profile 是两个独立的 vite SPA，构建产物是单一 JS bundle，server 通过 `ADMIN_STATIC_DIR` 把整个 dist 目录挂上即可服务。`80df8bb` 把 admin/profile 迁移到 Next.js 后，构建产物变成：
- `packages/web/out/my/<page>.html` — 静态 HTML（body 几乎空）
- `packages/web/out/_next/static/chunks/*.js` — React hydration 所需的多个 chunk
- `packages/web/out/_next/static/css/*.css` — 样式

`helpers.ts` 注册了 `/my/*` 路由（通过 `myServeRoutes` 读 HTML），但**没注册 `/_next/*` 路由**——浏览器拿到 HTML 后请求 JS 拿到 404，React 永远不 hydration，测试全部失败。

此外：
- `admin.test.ts` 还在用旧 SPA 时代的 `/admin` 路径和文案（"用户"/"应用"/"运营大盘"/"配置"/"分组"）
- `profile.test.ts` 路径已经是 `/my/info`，只受基础设施问题影响
- `helpers.ts` 中 `ADMIN_STATIC_DIR` 环境变量已无用（旧 SPA 删除后没引用方）

## Goals / Non-Goals

**Goals:**
- 让 `packages/server/tests/e2e-ui/` 套件对新 Next.js web 包可用，至少 `admin.test.ts` 和 `profile.test.ts` 的核心用例全部通过
- 同步更新 `admin.test.ts` 文案/路径，对齐当前 web 实际 UI（详见 proposal 修改清单）
- 清理 `helpers.ts` 中的死代码 `ADMIN_STATIC_DIR`

**Non-Goals:**
- 不改业务代码（server、web 包），不动 API
- 不重写测试用例的语义（保留原有覆盖范围）
- 不引入 vitest + jsdom 组件级测试方案
- 不在 playwright config 加 webServer 启动 dev 模式 next dev（成本高、CI 资源消耗大）
- 不修 `e2e-ui-testing` spec 里"登录注册页面 UI 测试"requirement（描述的 SPA 路由已被 unify-auth-modals 改成模态框，是另一个独立清理范围）

## Decisions

### Decision 1: 用 `@fastify/static` 服务 `/_next/*`

**选择**：在 `helpers.ts` 注册 `@fastify/static`（已在 server 依赖 `^7.0.4`），prefix 设为 `/_next`，root 指向 `packages/web/out/_next`。

**理由**：
- `@fastify/static` 已经在依赖里，零新增
- 它处理 prefix、ETag、缓存头等细节，比手写 readFile 健壮
- 直接复用项目里已熟悉的库

**Alternatives**:
- (a) 手写 `app.get('/_next/*', ...)` + readFile：实现简单，但 MIME 类型、缓存、错误处理都要自己写
- (b) 在 my-serve.ts 里也加 `_next/*` 路由：影响生产 server，本变更只想动测试

### Decision 2: 在 helpers.ts 里挂载，不改 my-serve.ts

**选择**：只在测试用 fastify 实例里注册静态服务，不动生产 server。

**理由**：
- 生产 server 用 `node packages/server/dist/index.js`，静态文件由 reverse proxy（如 nginx）或专门路径处理
- 测试 server 是独立 fastify 实例，本变更只关心测试可用
- 避免影响生产 server 的路由表

### Decision 3: admin.test.ts 文案修改清单（执行级参考）

按当前 web 包 UI 实际值修改：

| 类型 | 旧值 | 新值 |
|---|---|---|
| URL | `/admin` | `/my/dashboard`（默认页） |
| URL | `/admin/groups` | `/my/orgs`（admin 群组管理） |
| Link name | `"用户"` | `"用户管理"` |
| Link name | `"应用"` | `"应用管理"` |
| Link name | `"运营大盘"` | `"数据分析"` |
| Link name | `"配置"` | `"系统配置"` |
| Link name | `"概览"` | `"系统概览"` |
| Link name | `"分组"` | `"组织管理"` |
| Heading | `"运营大盘"` | `"数据分析"` |
| Heading | `"分组管理"` | `"群组管理"` |
| Button | `"新建分组"` | `"新建群组"` |
| Text/Heading | `"新建系统分组"` | `"新建系统群组"` |
| Placeholder | `"输入分组名称"` | `"群组名称"` |
| Test name | `non-admin user gets 403 on /admin` | `non-admin user is redirected from admin pages`（行为是 302 重定向到 `/`） |
| Test name | `Logout redirects to login` | `Logout shows login modal`（web 用模态框，不跳转） |

### Decision 4: profile.test.ts 仅修基础设施

**选择**：profile.test.ts 路径已是 `/my/info`，但具体 DOM 文案（"我的应用" / "API Key" / "设置昵称" 等）需要核对当前 web 的 info 页面是否一致。如果不一致，按 web 实际值修改；如果一致，不动。

**理由**：先跑一次测试看哪些失败，再针对性修。

## Risks / Trade-offs

- **[风险] `@fastify/static` 路径配置踩坑** → Mitigation：参考其他 fastify 项目用例，root 用绝对路径 `path.resolve(__dirname, "../../../../web/out/_next")`；prefix 设 `/_next`；先写一个最小冒烟测试（仅访问 `/_next/static/chunks/` 下的某个 JS 文件确认 200）再做完整测试
- **[风险] profile.test.ts 中的头像上传测试依赖具体 DOM 结构** → Mitigation：先跑测试看失败原因，再针对性修；如确实无法用 e2e 表达，标 `test.skip` 并附 issue 注释，不阻塞主流程
- **[风险] React hydration 异步，可能需要 `waitFor` 而不是 `toBeVisible({timeout})`** → Mitigation：playwright `toBeVisible` 本身就是 auto-retry，10s timeout 应足够；若仍超时，再加 `page.waitForLoadState("networkidle")`
- **[权衡] 不顺手清理"登录注册页面 UI 测试"requirement** → 该 spec 描述的 SPA 路由已被 unify-auth-modals 改为模态框，本变更扩范围会让 review 失焦；留给独立变更处理

## Migration Plan

按顺序：

1. 修 `helpers.ts`：删 `ADMIN_STATIC_DIR`，加 `@fastify/static` 注册 `/_next/*`
2. 写冒烟测试（临时）：访问 `/_next/static/chunks/` 下任意 .js 文件，断言 200
3. 跑 profile.test.ts：因为路径已对，应该基本能过；针对失败点修
4. 跑 admin.test.ts：先看失败列表，按 Decision 3 的清单逐项修
5. 删冒烟测试，全量跑 admin.test.ts + profile.test.ts 确认通过
6. 提交：`fix(test): e2e-ui 套件服务 Next.js 静态资源，对齐 web 包新 UI`

**Rollback**: 任一步骤失败，`git revert` 整个变更即可。测试基础设施改动隔离在 helpers.ts 和测试文件里，无业务影响。

## Open Questions

无。所有决策点已在上文明确。

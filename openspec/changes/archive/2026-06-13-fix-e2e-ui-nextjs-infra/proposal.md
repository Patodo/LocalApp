## Why

`e2e-ui` 测试套件（`packages/server/tests/e2e-ui/`）自 `80df8bb`（admin/profile 迁移到 Next.js）起对**新 web 包整体失效**：

- `helpers.ts` 启动的临时 fastify server 只注册业务路由（`/api/*`、`/my/*`、`/serve/*`），**不服务 `/_next/static/*`**
- 新 web 是 Next.js 静态导出，HTML body 几乎空，所有内容由 React 在浏览器 hydration 后渲染
- 浏览器加载 `/my/users.html` 后请求 `<script src="/_next/static/chunks/...">` 拿到 404 → React 不 hydration → heading 永不出现 → 测试 timeout 失败

实测：`admin.test.ts` 11 个用例只通过 1 个（"非 admin 重定向"——不依赖 hydration），`profile.test.ts` 全部失败。**main 上 e2e-ui 套件对新 web 包零守护能力**，任何 web 回归都得靠肉眼。

## What Changes

- **修 `packages/server/tests/e2e-ui/helpers.ts`**：注册 `/_next/*` 静态资源服务，把 `packages/web/out/_next/` 整个目录挂上（用 `@fastify/static` 或手写 readFile handler）
- **修 `packages/server/tests/e2e-ui/admin.test.ts`**：更新所有旧 SPA 文案/路径到当前 Next.js web 包的 UI 实际值：
  - 路径：`/admin` → `/my/dashboard`、`/my/users`、`/my/pages`、`/my/analytics`、`/my/settings`、`/my/orgs`
  - sidebar link 名：`"用户"` → `"用户管理"`、`"应用"` → `"应用管理"`、`"运营大盘"` → `"数据分析"`、`"配置"` → `"系统配置"`、`"概览"` → `"系统概览"`、`"分组"` → `"组织管理"`
  - heading 名：`"运营大盘"` → `"数据分析"`、`"分组管理"` → `"群组管理"`
  - 弹窗文案：`"新建分组"` → `"新建群组"`、`"新建系统分组"` → `"新建系统群组"`、`"输入分组名称"` → `"输入群组名称"`
  - 行为修正：`"non-admin user gets 403 on /admin"` 改为 `"non-admin user is redirected from admin pages"`（my-serve.ts 实际是 302 重定向到 `/`）；`"Logout redirects to login"` 改为 `"Logout shows login modal"`（web 用模态框，不跳转）
- **修 `packages/server/tests/e2e-ui/profile.test.ts`**：把 `/profile` 路径全部改为 `/my/info`，核对文案与当前 web 包 UI 一致
- **清理** `helpers.ts` 中已无用的 `ADMIN_STATIC_DIR` 环境变量（旧 SPA 的遗留）

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `e2e-ui-testing`: "Playwright 测试基础设施" requirement 增加约束"测试 server 必须服务 Next.js 静态资源 `/_next/*`"，"Profile SPA UI 测试" requirement 把路径从 `/profile` 改为 `/my/info`

## Impact

**受影响代码**:
- 修改：`packages/server/tests/e2e-ui/helpers.ts`（新增 `/_next/*` 静态服务、清理 `ADMIN_STATIC_DIR`）
- 修改：`packages/server/tests/e2e-ui/admin.test.ts`（路径 + 文案 + 行为修正，约 20 处）
- 修改：`packages/server/tests/e2e-ui/profile.test.ts`（路径 + 文案）
- 可能新增依赖：`@fastify/static`（如已安装则跳过）

**不受影响**:
- 业务代码（server、web）零改动
- API 行为零改动
- `cli-*.test.js` 系列（不依赖 web 包，仅测 CLI 子进程）
- 现有 spec 中描述的页面行为（修测试是对齐 spec，不是改 spec 描述的行为）

**风险评估**:
- `@fastify/static` 路径前缀和 SPA fallback 配置易踩坑（前一次失败就是因为这点）
- profile.test.ts 中头像上传测试可能依赖具体 DOM 结构，需逐个验证
- 全部测试通过后才能确认基础设施修对，期间会有反复

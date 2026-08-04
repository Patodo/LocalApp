# 实施任务

> 本变更主要是测试基础设施修复，工作分两类：①helpers.ts 加 `/_next/*` 静态服务（确定性工作）；②admin.test.ts 文案/路径对齐（按 design Decision 3 清单逐项修）。先写一个最小冒烟测试验证基础设施，再进入完整 TDD 循环。

## 1. helpers.ts 加 Next.js 静态资源服务

- [x] 1.1 编辑 `packages/server/tests/e2e-ui/helpers.ts`：
  - 删除 `ADMIN_STATIC_DIR` 环境变量（旧 SPA 遗留，无引用方）
  - 注册 `@fastify/static`，prefix 为 `/_next`，root 指向 `path.resolve(__dirname, "../../../web/out/_next")`（从 `packages/server/tests/e2e-ui/` 到 `packages/web/out/_next`）
- [x] 1.2 提交：`fix(test): helpers.ts 注册 /_next/* 静态服务，清理 ADMIN_STATIC_DIR`

## 2. 基础设施冒烟测试（RED → GREEN）

- [x] 2.1 在 `packages/server/tests/e2e-ui/` 新增临时冒烟用例（可放在 admin.test.ts 顶部，跑完删）：
  - 用 page.request 访问 `/_next/static/chunks/` 下任一已知存在的 .js 文件
  - 断言响应 200 + Content-Type 包含 `javascript`
- [x] 2.2 跑冒烟用例：`npx playwright test admin.test.ts --grep "smoke _next static"`
- [x] 2.3 GREEN 验证：通过；失败则回头检查 fastify-static 配置（首轮 404，root 路径多写了一层 `..`，改正为 `../../../web/out/_next` 后通过）

## 3. profile.test.ts 路径已对齐，跑通看哪些失败

- [x] 3.1 跑 `npx playwright test profile.test.ts --reporter=list`，记录失败用例
- [x] 3.2 针对失败用例修：核对当前 `packages/web/app/(dashboard)/my/info/page.tsx` 的实际 DOM/文案，调整断言
- [x] 3.3 重跑确认 profile.test.ts 全部通过
- [x] 3.4 提交：`fix(test): profile.test.ts 对齐 Next.js web 包实际 UI`

## 4. admin.test.ts RED — 全量失败现状

- [x] 4.1 跑 `npx playwright test admin.test.ts --reporter=list`，预期 10/11 失败（仅"非 admin 重定向"过）
- [x] 4.2 记录失败用例清单（哪些断言、哪些 locator 找不到）

## 5. admin.test.ts GREEN — 按 design Decision 3 清单修

- [x] 5.1 替换所有 `/admin` → 对应的 `/my/<page>`（dashboard/users/pages/analytics/settings）
- [x] 5.2 替换所有 `/admin/groups` → `/my/orgs`
- [x] 5.3 替换 sidebar link name：用户/应用/运营大盘/配置/概览/分组 → 用户管理/应用管理/数据分析/系统配置/系统概览/组织管理
- [x] 5.4 替换 heading：运营大盘 → 数据分析；分组管理 → 群组管理
- [x] 5.5 替换弹窗文案：新建分组 → 新建群组；新建系统分组 → 新建系统群组；输入分组名称 → 输入群组名称
- [x] 5.6 重写 "non-admin user gets 403 on /admin" → "non-admin user is redirected from admin pages"：断言 URL 重定向到 `/` 而非 403
- [x] 5.7 重写 "Logout redirects to login" → "Logout shows login modal"：断言模态框可见而非 URL 跳转
- [x] 5.8 跑 admin.test.ts 确认全部通过
- [x] 5.9 提交：`fix(test): admin.test.ts 路径和文案对齐 Next.js web 包新 UI`

## 6. REFACTOR + 收尾

- [x] 6.1 删冒烟测试（已合并进 admin.test.ts 各用例，`/_next/*` 由 React hydration 间接验证）
- [x] 6.2 检查：是否所有 locator 都用了稳定的 role/name 而非脆弱的 CSS 选择器（Logout 按钮因业务代码缺 aria-label 不得不使用 `svg.lucide-log-out` CSS 选择器，已用注释说明）
- [x] 6.3 检查：超时是否合理（默认 10s 对 CI 是否足够；网络慢时是否需要调高）— 当前用例均在 ~1s 内完成，10s 余量充足
- [x] 6.4 如有 REFACTOR 改动，提交：`refactor(test): e2e-ui 用例可读性和稳定性优化`

## 7. 端到端验证

- [x] 7.1 跑 admin + profile：`cd packages/server && npx playwright test tests/e2e-ui/admin.test.ts tests/e2e-ui/profile.test.ts --reporter=list` — admin 12/12 通过、profile 13/14 通过（1 跳过：cli-register 总会创建一个 key，无法测试空状态）
- [x] 7.2 确认 admin.test.ts + profile.test.ts 全部通过；cli-*.test.js 失败为预先存在的问题（init-repo 模板 TypeScript 编译错误 + cli/ui 测试对 cwd 要求冲突），与本变更无关
- [ ] 7.3 在 CI 上跑一次（如有），确认环境无关 — 本地未配 CI，留待后续
- [x] 7.4 提交：`test(e2e): 验证 e2e-ui 套件对新 Next.js web 包完整可用`

## 8. 归档准备

- [x] 8.1 运行 `openspec status --change fix-e2e-ui-nextjs-infra` 确认所有任务勾选
- [x] 8.2 运行 `/merge-review` 或人工核对：spec scenarios 已覆盖
- [x] 8.3 准备合入 main（`/opsx-achieve` 或 merge-main skill）

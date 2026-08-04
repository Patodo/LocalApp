## Tasks

- [x] **Task 1: 实现 Server 端 `GET /api/users` 路由**
  在 `packages/server/src/routes/` 新增用户列表路由（或复用现有文件）。实现要点：
  - 鉴权：复用现有 auth 插件，要求已登录（Cookie 或 API Key）
  - 查询：调用 `meta-sqlite.ts` 中现有 `listUsers()` 或新增简化版函数
  - 返回字段：只返回 `id`、`name`、`displayName`，过滤敏感信息
  - 注册路由到 server 入口

  **TDD**: RED
  - 在 `packages/server/tests/integration/` 新增测试文件
  - 测试：已登录用户获取列表返回 200 + 正确字段
  - 测试：未登录用户返回 401
  - 测试：返回数据不含敏感字段（password、role、storageUsed 等）

  **TDD**: GREEN
  - 实现路由，测试通过

  **验证**: `npx vitest run tests/integration/` 通过

---

- [x] **Task 2: 实现 SDK `useUsers()` Hook**
  在 `init-repo/src/lib/localapp/` 中新增 `useUsers` Hook。

  实现要点：
  - `client.ts`：新增 `users()` 方法，调用 `/api/users`（不经过 basePath，与 `me()` 一致）
  - `types.ts`：新增 `UserBasic` 类型 `{ id: string; name: string; displayName: string | null }`
  - `react.ts`：新增 `useUsers()` Hook，返回 `{ users, loading, error }`
  - `index.ts`：导出 `useUsers` 和 `UserBasic`

  **TDD**: RED
  - 暂无独立的 SDK 单元测试框架，通过 E2E 测试验证

  **TDD**: GREEN
  - 实现 Hook 代码

  **验证**: TypeScript 编译通过

---

- [x] **Task 3: 更新 init-repo CLAUDE.md 文档**
  在 `init-repo/CLAUDE.md` 的 SDK 参考部分新增 `useUsers()` 用法说明。

  **验证**: 文档包含 useUsers 示例代码

---

- [x] **Task 4: E2E 测试验证全链路**
  在 `packages/server/tests/e2e-ui/` 新增或扩展测试，验证 useUsers 在浏览器中的完整链路。

  **TDD**: RED
  - 新增测试：构造含 `useUsers` 调用的 HTML，验证返回用户列表
  - 新增测试：未登录状态下验证错误处理

  **TDD**: GREEN
  - 测试通过

  **验证**: `npx playwright test` 全部通过

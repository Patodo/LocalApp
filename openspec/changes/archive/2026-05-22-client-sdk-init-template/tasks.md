## 1. 包结构与配置

- [x] 1.1 创建 `packages/client/` 包结构：`package.json`（name: `@localapp/client`，零 dependencies，react peerDependency）、`tsconfig.json`（继承根配置）、`src/index.ts`（空导出）
- [x] 1.2 更新 `pnpm-workspace.yaml`，确认 `packages/*` 已覆盖 client（如需显式添加则添加）
- [x] 1.3 在根 `package.json` 添加 `sync:sdk` 脚本，将 `packages/client/src/` 复制到 `init-repo/src/lib/localapp/`
- [x] 1.4 在 `packages/client/` 安装测试依赖：`vitest`、`jsdom`、`@testing-library/react`、`react`、`react-dom`（devDependencies）
- [x] 1.5 commit: `chore(client): 初始化 @localapp/client 包结构与配置`

## 2. SDK 类型与 HTTP 客户端

- [x] 2.1 [RED] 编写 `createClient` basePath 自动检测的失败测试：iframe 路径 `/serve/alice/my-app/index.html` → basePath `/serve/alice/my-app/api`；根路径 `/` → `/api`
- [x] 2.2 [RED] 编写 `createClient` CRUD 方法（list、get、create、update、delete、count）的失败测试，mock fetch 验证请求路径、方法、body
- [x] 2.3 [GREEN] 实现 `src/types.ts`：导出 `User`、`ListOptions`、`Pagination`、`CrudResponse` 等类型
- [x] 2.4 [GREEN] 实现 `src/client.ts`：`createClient()` 自动检测 basePath，返回包含 `me()`、`list()`、`get()`、`create()`、`update()`、`delete()`、`count()` 方法的对象
- [x] 2.5 [GREEN] 实现 `src/index.ts`：统一导出 `createClient` 和所有类型
- [x] 2.6 [REFACTOR] 检查 client.ts 错误处理和类型安全，确保非 2xx 响应正确抛出
- [x] 2.7 commit: `feat(client): 实现 createClient HTTP 客户端与类型定义`

## 3. SDK React Hooks — 查询类

- [x] 3.1 [RED] 编写 `useMe` Hook 失败测试：mock `GET /api/me` 返回已登录用户和 null 两种情况
- [x] 3.2 [RED] 编写 `useList` Hook 失败测试：mock `GET {basePath}/posts` 验证 rows、pagination、loading 状态变化；测试 options 参数（filters、offset、limit、sort、order）正确拼接到 URL
- [x] 3.3 [RED] 编写 `useGet` Hook 失败测试：mock `GET {basePath}/posts/1` 验证 row 和 loading 状态
- [x] 3.4 [RED] 编写 `useCount` Hook 失败测试：mock `GET {basePath}/posts/count` 验证 count 值和 filters 参数
- [x] 3.5 [GREEN] 实现 `src/react.ts`：`useMe()`、`useList(resource, options?)`、`useGet(resource, id)`、`useCount(resource, filters?)`，使用 `useState` + `useEffect`，调用 `createClient()` 的方法
- [x] 3.6 [GREEN] 在 `src/index.ts` 中导出所有 React Hook
- [x] 3.7 [REFACTOR] 抽取通用的 `useFetch` 内部 Hook 减少重复逻辑
- [x] 3.8 commit: `feat(client): 实现查询类 React Hooks (useMe/useList/useGet/useCount)`

## 4. SDK React Hooks — 变更类

- [x] 4.1 [RED] 编写 `useCreate` Hook 失败测试：验证 `create(data)` 调用 `POST {basePath}/posts`，body 正确，返回创建的记录
- [x] 4.2 [RED] 编写 `useUpdate` Hook 失败测试：验证 `update(id, data)` 调用 `PUT {basePath}/posts/1`，返回更新后的记录
- [x] 4.3 [RED] 编写 `useDelete` Hook 失败测试：验证 `remove(id)` 调用 `DELETE {basePath}/posts/1`
- [x] 4.4 [GREEN] 在 `src/react.ts` 中实现 `useCreate(resource)`、`useUpdate(resource)`、`useDelete(resource)`，返回命令函数
- [x] 4.5 [GREEN] 在 `src/index.ts` 中导出变更类 Hook
- [x] 4.6 [REFACTOR] 检查变更类 Hook 的错误处理和 loading 状态
- [x] 4.7 commit: `feat(client): 实现变更类 React Hooks (useCreate/useUpdate/useDelete)`

## 5. SDK 同步脚本与集成验证

- [x] 5.1 执行 `pnpm sync:sdk` 验证 `packages/client/src/` 正确复制到 `init-repo/src/lib/localapp/`（创建目标目录如不存在）
- [x] 5.2 验证 `packages/client/` 的所有单元测试通过：`pnpm --filter @localapp/client test`
- [x] 5.3 commit: `chore(client): 添加 sync:sdk 脚本并验证同步`

## 6. Init 模板创建

- [x] 6.1 创建 `init-repo/` 目录结构：`package.json`（react、react-dom、vite、@vitejs/plugin-react、typescript）、`vite.config.ts`、`tsconfig.json`、`index.html`
- [x] 6.2 创建 `init-repo/src/main.tsx`：React 入口文件，挂载 App 组件
- [x] 6.3 执行 `pnpm sync:sdk` 将 SDK 源码复制到 `init-repo/src/lib/localapp/`
- [x] 6.4 创建 `init-repo/src/App.tsx`：示例页面，展示 useMe、useList、useCreate 的用法，包含完整的 JSX 渲染逻辑
- [x] 6.5 编写 `init-repo/CLAUDE.md`：包含平台能力概述、SDK Hook 参考（签名、参数、示例）、CLI 命令参考、访问控制配置说明
- [x] 6.6 在 `init-repo/` 中执行 `npm install && npm run build`，验证模板可成功构建
- [x] 6.7 commit: `feat(init-template): 创建 Vite+React 模板与 CLAUDE.md`

## 7. 文档更新

- [x] 7.1 更新根 `README.md`：添加 `packages/client` 和 `init-repo` 的说明，更新架构描述
- [x] 7.2 更新 `openspec/config.yaml` 的 context：添加 packages/client 和 init-repo 的描述
- [x] 7.3 commit: `docs: 更新 README 和 config.yaml 说明 SDK 与模板`

## 8. E2E 测试

| Spec Scenario | E2E Test | Status |
|---|---|---|
| client-sdk > Scenario: 包结构验证 | 验证 packages/client 目录和文件存在 | ✓ |
| client-sdk > Scenario: 零运行时依赖 | 验证 package.json 无 dependencies | ✓ |
| client-sdk > Scenario: iframe 内自动检测 | 测试 createClient 从 iframe pathname 解析 basePath | ✓ |
| client-sdk > Scenario: 根路径访问 | 测试 createClient 根路径下 basePath 为 /api | ✓ |
| client-sdk > Scenario: 已登录用户 useMe | mock fetch 验证 useMe 返回用户数据 | ✓ |
| client-sdk > Scenario: 未登录用户 useMe | mock fetch 验证 useMe 返回 null | ✓ |
| client-sdk > Scenario: 基本列表查询 | mock fetch 验证 useList 请求和返回 | ✓ |
| client-sdk > Scenario: 带筛选条件的查询 | mock fetch 验证 filters 参数拼接 | ✓ |
| client-sdk > Scenario: 带分页和排序的查询 | mock fetch 验证 offset/limit/sort/order 参数 | ✓ |
| client-sdk > Scenario: 手动刷新 | 验证 refresh() 重新发起请求 | ✓ |
| client-sdk > Scenario: 查询存在的记录 | mock fetch 验证 useGet 返回记录 | ✓ |
| client-sdk > Scenario: 查询不存在的记录 | mock fetch 验证 useGet 返回 null | ✓ |
| client-sdk > Scenario: 成功创建 | mock fetch 验证 create POST 请求 | ✓ |
| client-sdk > Scenario: 创建失败（字段校验） | mock fetch 验证 create 错误处理 | ✓ |
| client-sdk > Scenario: 成功更新 | mock fetch 验证 update PUT 请求 | ✓ |
| client-sdk > Scenario: 成功删除 | mock fetch 验证 remove DELETE 请求 | ✓ |
| client-sdk > Scenario: 基本计数 | mock fetch 验证 useCount 请求和返回 | ✓ |
| client-sdk > Scenario: 带筛选条件的计数 | mock fetch 验证 useCount filters 参数 | ✓ |
| client-sdk > Scenario: 执行同步脚本 | 验证 pnpm sync:sdk 正确复制文件 | ✓ |
| init-template > Scenario: 模板目录验证 | 验证 init-repo 包含所有必需文件 | ✓ |
| init-template > Scenario: 模板不在 pnpm workspace 中 | 验证 pnpm-workspace.yaml 不含 init-repo | ✓ |
| init-template > Scenario: 安装依赖 | 在 init-repo 执行 npm install 验证成功 | ✓ |
| init-template > Scenario: 构建项目 | 在 init-repo 执行 npm run build 验证成功 | ✓ |
| init-template > Scenario: SDK 源码可用 | 验证从 App.tsx import SDK 成功且构建通过 | ✓ |
| init-template > Scenario: 示例页面包含 SDK 调用 | 验证 App.tsx 使用 useMe/useList/useCreate | ✓ |
| init-template > Scenario: 示例页面可构建 | 验证包含 SDK 调用的 App.tsx 可成功构建 | ✓ |
| init-template > Scenario: CLAUDE.md 包含 Hook 文档 | 验证 CLAUDE.md 包含每个 Hook 的签名和示例 | ✓ |
| init-template > Scenario: CLAUDE.md 包含 CLI 命令 | 验证 CLAUDE.md 包含 schemas create、upload 等命令 | ✓ |
| init-template > Scenario: CLAUDE.md 包含访问控制说明 | 验证 CLAUDE.md 包含访问控制配置说明 | ✓ |
| monorepo-structure > Scenario: client 子包结构 | 验证 packages/client 包含 index.ts/package.json/tsconfig.json | ✓ |
| monorepo-structure > Scenario: init-repo 不参与 pnpm 管理 | 验证 pnpm install 不处理 init-repo | ✓ |
| monorepo-structure > Scenario: init-repo 包含完整可运行项目 | 复制 init-repo 并执行 install+build 验证 | ✓ |

- [x] 8.1 [GREEN] 为 client-sdk > Scenario: 包结构验证 编写 e2e 测试
- [x] 8.2 [GREEN] 为 client-sdk > Scenario: 零运行时依赖 编写 e2e 测试
- [x] 8.3 [GREEN] 为 client-sdk > Scenario: iframe 内自动检测 / 根路径访问 编写 e2e 测试
- [x] 8.4 [GREEN] 为 client-sdk > Scenario: useMe 已登录/未登录 编写 e2e 测试
- [x] 8.5 [GREEN] 为 client-sdk > Scenario: useList 基本查询/筛选/分页排序/手动刷新 编写 e2e 测试
- [x] 8.6 [GREEN] 为 client-sdk > Scenario: useGet 存在/不存在记录 编写 e2e 测试
- [x] 8.7 [GREEN] 为 client-sdk > Scenario: useCreate 成功/失败 编写 e2e 测试
- [x] 8.8 [GREEN] 为 client-sdk > Scenario: useUpdate/useDelete 编写 e2e 测试
- [x] 8.9 [GREEN] 为 client-sdk > Scenario: useCount 基本/带筛选 编写 e2e 测试
- [x] 8.10 [GREEN] 为 client-sdk > Scenario: 执行同步脚本 编写 e2e 测试
- [x] 8.11 [GREEN] 为 init-template > Scenario: 模板目录验证 / 不在 workspace / 安装依赖 / 构建项目 编写 e2e 测试
- [x] 8.12 [GREEN] 为 init-template > Scenario: SDK 源码可用 / 示例页面 编写 e2e 测试
- [x] 8.13 [GREEN] 为 init-template > Scenario: CLAUDE.md 内容验证 编写 e2e 测试
- [x] 8.14 [GREEN] 为 monorepo-structure > Scenario: client 子包结构 / init-repo 不参与 pnpm 编写 e2e 测试
- [x] 8.15 执行全部 e2e 测试，验证所有测试通过
- [x] 8.16 更新映射表中所有 Status 为 ✓
- [x] 8.17 commit: `test(client): 添加 SDK 与模板 e2e 测试`

## 1. 项目骨架搭建

- [x] 1.1 创建 `packages/sdk-core/` 目录，包含 `package.json`、`tsconfig.json`、`src/`
- [x] 1.2 创建 `packages/sdk-react/` 目录，包含 `package.json`、`tsconfig.json`、`src/`
- [x] 1.3 创建 `packages/sdk-agent/` 目录，包含 `package.json`、`tsconfig.json`、`src/`
- [x] 1.4 配置 pnpm workspace，确保三个包可被本地引用 (`workspace:*`) — **commit: "chore: scaffold sdk-core, sdk-react, sdk-agent packages"**

## 2. @localapp/sdk (sdk-core) 实现

- [x] 2.1 从 `init-repo/src/lib/localapp/types.ts` 提取类型定义到 `packages/sdk-core/src/types.ts`，验证类型编译通过
- [x] 2.2 从 `init-repo/src/lib/localapp/client.ts` 提取 `createClient()`、`LocalAppClient`、`LocalAppError`、`detectBasePath()`、`redirectToLogin()` 到 `packages/sdk-core/src/client.ts`，验证所有方法签名不变
- [x] 2.3 编写 `packages/sdk-core/src/index.ts` 公共导出 — **commit: "feat(sdk-core): extract core client and types from init-repo"**

## 3. @localapp/sdk-react (sdk-react) 实现

- [x] 3.1 从 `init-repo/src/lib/localapp/react.ts` 提取所有 React Hooks 到 `packages/sdk-react/src/hooks/` (每个 Hook 一个文件)，import 路径改为从 `@localapp/sdk` 导入
- [x] 3.2 编写 `packages/sdk-react/src/index.ts` 公共导出
- [x] 3.3 验证 `@localapp/sdk-react` 的 peerDependencies 正确声明 `react` 和 `@localapp/sdk` — **commit: "feat(sdk-react): extract React hooks from init-repo"**

## 4. @localapp/sdk-agent (sdk-agent) 实现

- [x] 4.1 从 `init-repo/src/lib/localapp/agent/` 提取所有 Agent 相关代码到 `packages/sdk-agent/src/`，import 路径改为从 `@localapp/sdk` 和 `@localapp/sdk-react` 导入
- [x] 4.2 编写 `packages/sdk-agent/src/index.ts` 公共导出
- [x] 4.3 验证 `@localapp/sdk-agent` 的 peerDependencies 正确声明 `@localapp/sdk`、`@localapp/sdk-react`、`@assistant-ui/react` — **commit: "feat(sdk-agent): extract agent SDK from init-repo"**

## 5. 模板和 CLI 更新

- [x] 5.1 更新 `init-repo/package.json`，添加 `@localapp/sdk` 和 `@localapp/sdk-react` 依赖（workspace 协议），可选添加 `@localapp/sdk-agent`
- [x] 5.2 更新 `init-repo/src/App.tsx` 和 `init-repo/src/lib/` 中的 import 路径，从 `./lib/localapp/index.js` 改为 `@localapp/sdk` / `@localapp/sdk-react`
- [x] 5.3 更新 `init-repo/CLAUDE.md` 和 skill 文件中的 SDK import 示例
- [x] 5.4 移除 `init-repo/src/lib/localapp/` 目录
- [x] 5.5 修改 CLI `upload` 命令，移除 SDK 源码复制逻辑 (`commands/upload.rs` 中复制 `src/lib/localapp/` 的代码)
- [x] 5.6 编译 CLI 并验证 `localapp init` + `localapp upload` 流程在新的模板和 SDK 包下正常工作 — **commit: "refactor: use npm SDK packages instead of inline source files"**

## 6. 端到端验证

- [x] 6.1 执行完整流程：`localapp init` → 安装依赖 → 构建 → 上传，验证应用可正常访问和操作 CRUD API
- [x] 6.2 验证 `useAgent` Hook 和 `AgentChat` 组件在新包结构下正常工作（可选安装 agent 包后） — **commit: "test: verify e2e flow with npm SDK packages"**

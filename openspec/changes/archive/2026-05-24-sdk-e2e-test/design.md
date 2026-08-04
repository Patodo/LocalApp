## Context

SDK 的核心链路分三段协作：

1. **detectBasePath()**：从 `window.location.pathname` 提取 `/serve/{userId}/{name}/api` 作为 basePath
2. **fetch 请求**：用 basePath 拼接 CRUD 路径（如 `{basePath}/items`）
3. **Server 路由代理**：`/serve/:userId/:name/*` 中 `restPath.startsWith("api/")` → `handleCrudRequest()`

当前 SDK 单元测试用 mock fetch 验证了这些方法的输入输出，但没有验证三段拼接后是否能真实工作。需要 E2E 测试在真实浏览器 + 真实 Server 环境下验证。

现有 e2e-ui 测试基础设施（Playwright + helpers.ts）已支持启动 Server 和 CLI 操作，可复用。

## Goals / Non-Goals

**Goals:**
- 验证 SDK `detectBasePath()` 在真实浏览器 `/serve/{uid}/{name}/` 路径下正确检测 basePath
- 验证 SDK fetch 请求经 Server 代理后能正确到达 CRUD handler 并返回数据
- 验证 SDK create + list 全链路（写入数据 → 读取验证）
- 验证 init 模板的 React 应用在浏览器中能通过 Hook 渲染数据

**Non-Goals:**
- 不修改 SDK 或 Server 代码
- 不覆盖所有 SDK 方法（useGet/useUpdate/useDelete 等）—— 这些在单元测试中已覆盖，且全链路逻辑与 list/create 相同
- 不覆盖 SDK 的错误处理分支
- 不覆盖 useMe / useExec（me 走独立的 `/api/me` 路径，不经过 basePath；exec 走 `/db/exec` 路径）

## Decisions

### Decision 1: 层 A 测试用纯 HTML 内联 SDK 逻辑

层 A（SDK 核心链路）不上传完整 React 应用，而是构造一个最小 HTML 文件，内联 `detectBasePath` + `fetch` 逻辑，将结果写入 DOM 元素。

**理由**:
- 不需要 `npm install` + `npm run build`，测试从 ~10s 降到 ~3s
- 完全控制测试内容，不受 init 模板变化影响
- 直接测试 SDK 的核心路径检测和 fetch 逻辑

**替代方案**: 用 init 模板的 React App — 太慢，且 React 渲染的异步性增加 Playwright 等待复杂度。

### Decision 2: 层 B 测试用 init 模板验证 React Hook 渲染

层 B 单独测试 init 模板部署后的 React 应用能否在浏览器中正常渲染。

**理由**: init 模板是用户实际使用的入口，确保它能在浏览器中工作是有价值的。但这是独立于 SDK 核心链路的验证，所以分开测试。

### Decision 3: 测试文件命名为 cli-sdk.test.js

沿用 e2e-ui 目录中已有的 `.js` 命名（因 Playwright ESM 兼容性限制，helpers.ts 不可修改，新测试文件不能有顶层 `node:*` 或 `import.meta` 导入）。

## Risks / Trade-offs

- **Playwright ESM 限制** → 已在 e2e-restructure 中解决：只用 `import { test, expect } from "./helpers"`，其余用动态 `import()`
- **层 A 的内联 SDK 逻辑与实际 SDK 代码不同步** → 内联代码只复制 detectBasePath 正则和 fetch 调用模式，这些极少变化；即使不同步，测试仍验证了 Server 端路由的正确性
- **CLI 编译耗时** → 依赖预编译的 CLI 二进制，CI 需预装 Rust 工具链

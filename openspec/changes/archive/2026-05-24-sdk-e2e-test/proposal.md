## Why

SDK（`packages/client`）是用户前端应用调用平台能力的唯一入口，其核心链路 `detectBasePath() → fetch → Server CRUD API → 数据返回` 涉及 URL 路径检测、服务端路由代理、CRUD 响应格式三段协作。当前 SDK 只有单元测试（mock fetch），没有端到端验证。一旦 `detectBasePath` 正则、serve 路由格式或 CRUD 响应结构任一环节变化，SDK 静默失效，用户应用直接崩溃。需要真实浏览器 + 真实 Server 的 E2E 测试覆盖这条链路。

## What Changes

- 新增 Playwright E2E 测试：构造内含 SDK 核心逻辑的 HTML 页面，通过 CLI 部署后用浏览器验证 `detectBasePath` + CRUD 全链路
- 新增 Playwright E2E 测试：CLI init 模板部署后，验证 React Hook 渲染正常（App.tsx 能在浏览器中展示）
- 无 Server 代码改动、无 API 变更、无 SDK 代码改动

## Capabilities

### New Capabilities
- `sdk-full-chain-e2e`: SDK 核心链路端到端测试 — 验证 detectBasePath 路径检测 + fetch CRUD 请求在真实浏览器和 Server 环境下全链路可用
- `sdk-react-render-e2e`: SDK React Hook 渲染端到端测试 — 验证 init 模板的 React 应用在浏览器中通过 Hook 正确获取和渲染数据

### Modified Capabilities

（无）

## Impact

- `packages/server/tests/e2e-ui/`: 新增 1-2 个 Playwright 测试文件
- 测试依赖 CLI 二进制（需预编译）
- 测试依赖 schemas create（需 CLI 或 API 创建数据表）
- 不影响任何生产代码

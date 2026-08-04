## Tasks

- [x] **Task 1: 创建 SDK 核心链路 E2E 测试（层 A）**
  新建 `packages/server/tests/e2e-ui/cli-sdk.test.js`。测试流程：CLI init → schemas create items → 构造含内联 SDK 逻辑的 HTML（detectBasePath + fetch）→ CLI upload → Playwright 访问验证 basePath 检测 + list 空数据 + create + list 全链路。

  **TDD**: RED
  - 无 cli-sdk.test.js，测试不存在

  **实施**:
  - 新建 `cli-sdk.test.js`，`import { test, expect } from "./helpers"`
  - 通过动态 import 执行 CLI（init + schemas create + upload）
  - 构造测试 HTML 内联 detectBasePath 逻辑，将结果写入 `<div id="result">`
  - 通过 CLI upload 部署到 server
  - Playwright 读取 `#result` 验证

  **TDD**: GREEN
  - 测试通过：basePath 正确、list 返回空数组、create + list 返回新数据

  **验证**: `npx playwright test cli-sdk` 通过

---

- [x] **Task 2: 创建 React Hook 渲染 E2E 测试（层 B）**
  新建 `packages/server/tests/e2e-ui/cli-react-render.test.js`。测试流程：CLI init --builtin-repo（完整 React 模板部署）→ Playwright 访问 → 验证 `<h1>LocalApp App</h1>` 存在 + "Not logged in" 显示。

  **TDD**: RED
  - 无 cli-react-render.test.js，测试不存在

  **实施**:
  - 新建 `cli-react-render.test.js`
  - CLI init --builtin-repo → Playwright goto → 等 React hydration → 验证 DOM

  **TDD**: GREEN
  - 测试通过：h1 标题存在、未登录状态正确显示

  **验证**: `npx playwright test cli-react-render` 通过

---

- [x] **Task 3: 运行全量测试确认无回归**
  运行所有 Playwright 测试确认新测试不破坏现有测试。

  **验证**: `npx playwright test` 全部通过

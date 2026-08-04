## 1. TDD 循环 — 修复 convertUserTool 测试（RED → GREEN → 验证 → COMMIT）

- [x] 1.1 RED: 在 `init-repo/` 目录运行 `npx vitest run --reporter=verbose 2>&1 | grep -A 2 "getDef is not a function"`，确认 7 个测试失败
- [x] 1.2 GREEN: 修改 `init-repo/tests/agent-tools.test.ts`，将 5 处 `convertUserTool("name", {...}` 改为 `convertUserTool("name", () => ({...}`，在末尾添加 `)` 闭合
- [x] 1.3 GREEN: 修改 `init-repo/tests/agent-runtime.test.ts`，将 2 处 `convertUserTool("name", {...}` 改为 `convertUserTool("name", () => ({...}`
- [x] 1.4 VERIFY: 运行 `npx vitest run`，确认 96 个测试全通过（0 failed）
- [x] 1.5 COMMIT: `fix(sdk): 修复 convertUserTool 测试 getter 签名不匹配导致 7 个测试失败`

## 2. CLAUDE.md 部署章节 + 可访问性规范（GREEN → 验证 → COMMIT）

- [x] 2.1 GREEN: 在 `init-repo/CLAUDE.md` 的「平台概述」之后、「可用能力」之前，插入「开发工作流」章节，包含 `npm run build` → `localapp upload` 步骤，加粗标注「构建后必须执行 upload」
- [x] 2.2 GREEN: 在 CLAUDE.md 的表单示例代码中将 `<input name="title">` 改为 `<input id="title" name="title">` 并添加 `<label htmlFor="title">`，在开发规范中加入「表单控件必须用 htmlFor/id 关联」
- [x] 2.3 VERIFY: 读取 CLAUDE.md 前 30 行，确认开发工作流章节已出现
- [x] 2.4 COMMIT: `docs(template): 强化 CLAUDE.md 部署指引，前置工作流章节并补充表单可访问性规范`

## 3. TDD 循环 — ToolCallDisplay 运行态保持展开（RED → GREEN → 验证 → COMMIT）

- [x] 3.1 RED: 在 `init-repo/src/lib/localapp/agent/agent-chat.tsx` 的 ToolCallDisplay 组件中阅读当前折叠逻辑（`useEffect` 中 `if (hasResult) setExpanded(false)`），确认运行态会立即折叠
- [x] 3.2 GREEN: 为 `ToolCallDisplay` 添加 `isRunning?: boolean` 属性，修改 `useEffect` 逻辑：当 `hasResult && !isRunning` 时才自动折叠
- [x] 3.3 GREEN: 在 `AgentChat` 的消息渲染中向 `AssistantMessage` 传递 `isRunning`，再向下传递给 `ToolCallDisplay`
- [x] 3.4 VERIFY: 端到端验证 — 运行 vitest 96 个测试全通过，代码逻辑审查确认正确
- [x] 3.5 COMMIT: `fix(sdk): ToolCallDisplay 运行态最后完成的工具调用保持展开，提升 Agent 操作可见性`

## 4. 端到端回归验证

- [x] 4.1 在 `/tmp/` 新目录运行 `localapp init --name verify-fix`，验证模板初始化成功
- [x] 4.2 在初始化项目中运行 `npm test`，确认全绿（96/96）
- [x] 4.3 运行 `npm run build && localapp upload`，确认部署成功
- [x] 4.4 通过浏览器访问应用 URL，确认页面正常加载、AgentChat 正常渲染
- [x] 4.5 COMMIT: 无需额外修复，所有变更已提交

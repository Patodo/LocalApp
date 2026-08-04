## Context

全流程回归测试发现 init-repo 模板和 SDK 存在 4 个问题：测试失败（7 个）、Agent 遗漏部署步骤、ToolCallDisplay 执行态折叠过快、表单可访问性缺失。所有修复均限制在 `init-repo/` 目录，不影响 server/CLI/client 包。

`convertUserTool` 在设计上采取了 lazy getter 模式（`getDef: () => UserToolDef`），用于解决 React 闭包过期问题。但测试代码未同步更新，仍直接传入对象字面量。

## Goals / Non-Goals

**Goals:**
- 修复所有 SDK 测试，确保 `vitest run` 全绿
- 降低 Agent 遗漏 `localapp upload` 的概率
- 优化工具调用执行时的可见性

**Non-Goals:**
- 不修改 `convertUserTool` 的函数签名
- 不改变 ToolCallDisplay 的整体交互模式（折叠/展开）
- 不在 server 或 CLI 侧做任何修改

## Decisions

### 1. 测试修复：包裹 getter 而非改签名

**选择**: 将测试中的 `convertUserTool("name", {...})` 改为 `convertUserTool("name", () => ({...}))`

**备选方案**: 修改 `convertUserTool` 签名接受 `UserToolDef | (() => UserToolDef)`

选择前者因为：
- lazy getter 模式是设计意图，不应为测试妥协
- 测试本身应反映真实的调用方式
- 改动面更小（7 行 vs 函数体复杂度增加）

### 2. CLAUDE.md 重构：前置 + 醒目标记

**选择**: 在「平台概述」后立即插入「开发工作流」章节，使用加粗和引用块强调部署必须性

**备选方案**: 在 CLAUDE.md 末尾加醒目标记

选择前者因为 Agent 处理长文档时倾向于关注前 1/3 内容。CLAUDE.md 当前超过 600 行，部署章节在末尾基本被忽略。

### 3. ToolCallDisplay 保持最后工具展开

**选择**: 在 Agent 运行期间（`isRunning === true`），最后一条有结果到达的 tool call 不自动折叠

实现方式：
- `ToolCallDisplay` 接收一个可选的 `isLastCompleted: boolean` 属性
- `AgentChat` 判断当前消息是否为运行中的最后一条 assistant 消息
- 仅当 Agent 整体完成后（`isRunning === false`），所有工具折叠

## Risks / Trade-offs

- [测试签名改动] 虽然匹配真实调用方式，但未来若 `convertUserTool` 再次改签名，测试需要跟进 → 7 个地方相对少，可接受
- [CLAUDE.md 章节前移] 可能导致 Agent 过早执行部署（未充分理解 SDK）→ 部署章节明确写"修改代码后"才执行
- [ToolCall 保持展开] 运行期间的已完成工具也展开，可能增加滚动 → 工具调用通常 3-5 个，可接受

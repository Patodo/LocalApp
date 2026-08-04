## Why

全流程回归测试发现 init-repo 模板和 SDK 存在 4 个质量问题：SDK 单元测试大面积失败、Agent 部署步骤遗漏率高、工具调用展示在运行时自动折叠影响透明度、表单可访问性缺失。这些问题阻碍 AI Agent 高效开发，并在每个新项目中复现。

## What Changes

- **修复 `convertUserTool` 签名不匹配**：SDK 改为 lazy getter 模式后测试未同步更新，7 个测试报 `getDef is not a function`
- **强化 CLAUDE.md 部署指引**：将部署步骤从文末移至显眼位置，增加必须执行的强调标记，降低 Agent 遗漏率
- **优化 ToolCallDisplay 折叠行为**：执行中的工具调用保持展开，仅完成后折叠，让用户看清 Agent 当前操作
- **补充表单可访问性规范**：CLAUDE.md 中加入 `<label htmlFor>` 关联指引，后续 Agent 生成的表单自动合格

## Capabilities

### New Capabilities

- `sdk-test-fix`: `convertUserTool` 测试签名匹配修复，确保所有 init 项目测试通过
- `claude-deploy-emphasis`: CLAUDE.md 部署章节重构，将 `localapp upload` 提升为必须执行步骤
- `toolcall-auto-expand`: ToolCallDisplay 运行态展开逻辑优化，执行中的工具保持可见

### Modified Capabilities

- `assistant-ui-chat`: ToolCallDisplay 折叠判断从"有结果即折叠"改为"仅非当前执行中的工具折叠"
- `init-template`: CLAUDE.md 结构调整，部署章节前移并加醒目提示

## Impact

- `init-repo/tests/agent-tools.test.ts` — 5 处 `convertUserTool` 调用需包裹为 `() => (...)`
- `init-repo/tests/agent-runtime.test.ts` — 2 处同改
- `init-repo/CLAUDE.md` — 结构调整，新增「开发工作流」章节
- `init-repo/src/lib/localapp/agent/agent-chat.tsx` — `ToolCallDisplay` 折叠逻辑调整

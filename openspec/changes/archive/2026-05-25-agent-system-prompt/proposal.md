## Why

Agent SDK 在初始化时不注入当前用户信息，导致 LLM 不知道用户身份（姓名、部门等），无法主动完成涉及用户信息的操作（如自动填写表单提交请假申请）。系统提示词的工具使用引导过于模糊，LLM 倾向于给文字建议而非调用工具。

## What Changes

- Agent 初始化时自动获取当前用户信息（`/api/me`）和页面元信息（应用名称），注入到系统提示词的系统层
- 系统提示词改为两层结构：系统层（用户身份、应用信息、工具使用指令）+ 应用开发者层（`systemHint`）
- 增强工具使用的指令性引导，明确要求 LLM 在需求可映射到工具时必须调用工具
- `buildSystemPrompt` 拆分为系统级构建和应用级组合

## Capabilities

### New Capabilities
- `agent-context`: Agent 系统提示词的两层注入机制——系统层自动注入用户身份、应用信息和工具使用指令，应用层由开发者通过 systemHint 追加

### Modified Capabilities
- `init-template`: init-repo 中 agent SDK 的 `use-agent.ts` 和 `context.ts` 需要适配新的两层提示词结构

## Impact

- `init-repo/src/lib/localapp/agent/use-agent.ts` — 初始化逻辑增加用户信息和页面元信息的获取
- `init-repo/src/lib/localapp/agent/context.ts` — `buildSystemPrompt` 拆分为两层
- `init-repo/src/lib/localapp/client.ts` — 可能需要新增获取页面元信息的方法
- 向后兼容：`systemHint` 参数行为不变，开发者无需修改现有代码

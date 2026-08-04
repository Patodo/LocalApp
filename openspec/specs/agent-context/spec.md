## Purpose

This spec describes the expected behavior, acceptance criteria, and integration boundaries for the agent-context capability in LocalApp.

## Requirements

### Requirement: 系统提示词两层结构

Agent SDK 的系统提示词 SHALL 分为两层注入：系统层（平台自动生成）和应用层（开发者通过 `systemHint` 传入）。`buildSystemPrompt` 函数 SHALL 按系统层 → 数据层 → 应用层的顺序拼接。

#### Scenario: 两层提示词拼接
- **WHEN** 调用 `buildSystemPrompt(systemContext, schemaContext, hint)`
- **THEN** 返回的提示词按顺序包含：系统层内容、空行分隔、数据层内容（schema context）、空行分隔、应用层内容（hint）

#### Scenario: 无 schema context 时
- **WHEN** `schemaContext` 为空字符串
- **THEN** 系统提示词跳过数据层段落，系统层和应用层之间仅保留一个空行分隔

#### Scenario: 无 systemHint 时
- **WHEN** `hint` 为 undefined 或空字符串
- **THEN** 系统提示词跳过应用层段落，不追加额外内容

### Requirement: 系统层自动注入用户身份

`useAgent` 初始化时 SHALL 自动调用 `/api/me` 获取当前用户信息。如果用户已登录，系统层 SHALL 包含 `当前用户: {userName}`。如果用户未登录，系统层 SHALL 包含 `当前用户: 未登录`。

#### Scenario: 已登录用户
- **WHEN** 用户已登录且 `/api/me` 返回 `{ success: true, data: { name: "testuser" } }`
- **THEN** 系统提示词中包含 `当前用户: testuser`

#### Scenario: 未登录用户
- **WHEN** 用户未登录且 `/api/me` 返回 `{ success: true, data: null }`
- **THEN** 系统提示词中包含 `当前用户: 未登录`

#### Scenario: 获取用户信息失败
- **WHEN** `/api/me` 请求失败（网络错误或非 2xx）
- **THEN** 系统提示词中包含 `当前用户: 未知`，Agent 仍然正常初始化

### Requirement: 系统层自动注入应用名称

`useAgent` 初始化时 SHALL 从 `window.location.pathname` 解析当前应用名称。当路径匹配 `/serve/{userId}/{name}/` 模式时，系统层 SHALL 包含 `当前应用: {name}`。

#### Scenario: 在 native app 中运行
- **WHEN** 应用运行在 `/serve/testuser/leave-form/` 路径下
- **THEN** 系统提示词中包含 `当前应用: leave-form`

#### Scenario: 不在 serve 路径下运行
- **WHEN** 应用路径不匹配 `/serve/{userId}/{name}/` 模式（如本地开发 `http://localhost:5173/`）
- **THEN** 系统提示词中不包含应用名称行

### Requirement: 工具使用指令性引导

系统层 SHALL 包含工具使用规则，以指令形式要求 LLM 在用户需求可映射到工具操作时必须调用工具，而非仅给出文字建议。规则 SHALL 包含：主动使用工具的要求、信息不完整时先询问缺失参数的指引。

#### Scenario: 系统层包含工具规则
- **WHEN** 查看系统层内容
- **THEN** 包含明确的指令性规则，要求 LLM 在需求可映射到工具时调用工具执行

#### Scenario: LLM 主动调用工具
- **WHEN** 用户发送"我想请假，从6月1日到3日，年假，回老家"，且当前用户已登录，工具 `submitLeave` 可用
- **THEN** LLM SHALL 调用 `submitLeave` 工具（或先询问缺失的部门信息），而不是仅给出文字建议

### Requirement: Schema Context 使用页面级 API 端点

`fetchSchemaContext` SHALL 使用 `detectBasePath()` 获取页面级 API basePath，通过 `{basePath}/_schemas` 端点获取数据结构定义，而非硬编码的 `/api/schemas`。

#### Scenario: 在 native app 中获取 schema
- **WHEN** 应用运行在 `/serve/testuser/leave-form/` 路径下
- **THEN** `fetchSchemaContext` 请求 `/serve/testuser/leave-form/api/_schemas`

#### Scenario: 在本地开发环境获取 schema
- **WHEN** 应用运行在 `http://localhost:5173/` 路径下
- **THEN** `fetchSchemaContext` 请求 `/api/_schemas`

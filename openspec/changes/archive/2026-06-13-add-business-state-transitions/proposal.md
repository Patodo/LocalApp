## Why

P0 业务建模让应用能稳定表达数据归属、状态字段和记录级权限，但审批、工单、请假、报销等业务应用还需要“状态如何按规则流转”。如果仍把提交、审批、拒绝写成普通 `update`，Agent 和应用开发者容易绕过状态规则，导致按钮展示、权限判断和数据变更不一致。

## What Changes

- 新增轻量业务状态流转能力，允许 schema 声明状态字段、初始状态、允许的 transitions、目标状态和权限要求。
- 扩展 CRUD API，为记录提供 transition 执行端点，统一校验当前状态、目标状态、访问权限和可选输入。
- 扩展 React SDK，提供 `useTransitions()` 或等价 Hook，用于查询可用 transition 并执行状态流转。
- 扩展 init 模板和 Agent 指引，要求审批类、申请类、工单类应用优先使用 transition API 表达“提交、审批、拒绝、关闭”等动作。
- 保持普通 CRUD 更新能力向后兼容；没有声明 transitions 的 schema 行为不变。
- 本变更不包含完整工作流引擎、操作日志、通知、定时任务或多步骤编排；这些可作为后续 P1.x 变更。

## Capabilities

### New Capabilities
- `business-state-transitions`: 定义 LocalApp 业务记录的轻量状态流转能力，包括 transition 声明、可用动作查询、执行端点、权限校验和 SDK 使用模式。

### Modified Capabilities
- `schema-management`: 增加 transition 元数据声明和校验规则。
- `crud-api`: 增加记录 transition 查询和执行端点。
- `access-control`: 将 transition 动作纳入访问控制语义，复用现有页面级、路由级和记录级权限边界。
- `sdk-react`: 增加状态流转 Hook，帮助应用查询可用动作并执行 transition。
- `init-template`: 增加状态流转指引和示例入口。
- `agent-data-skill`: 增加 Agent 对业务状态流转的建模规则。

## Impact

- 影响服务端 schema 类型、meta.json schema 存储结构、CRUD 路由和访问控制 helper。
- 影响 `@localapp/sdk-react` 的导出 API，但必须保持现有 Hook 向后兼容。
- 影响 `init-repo/` 的 `CLAUDE.md`、`.claude/skills/` 指引和默认业务示例。
- 可能需要扩展 CLI schema 文件输入，使 transition 声明可以随 schema 一起创建。
- 与 `add-business-app-model-guidance` 形成自然依赖：P0 定义业务字段和权限，P1 在这些字段上执行状态流转。

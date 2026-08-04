## ADDED Requirements

### Requirement: 模板包含 backend action 示例
init template SHALL 包含 backend action 开发约定、示例文件和文档，展示如何使用 `defineAction` 与 `ctx` 编写服务端业务逻辑。

#### Scenario: 模板包含 actions 目录
- **WHEN** 执行 `localapp init leave-form`
- **THEN** 项目 SHOULD 包含 `backend/actions/` 示例目录或清晰的占位说明
- **AND** 示例 SHALL 展示 `defineAction`、`ctx.query` 和 `ctx.mutate`

#### Scenario: CLAUDE.md 包含 action 指南
- **WHEN** AI 或开发者阅读 init-repo/CLAUDE.md
- **THEN** 文档 MUST 说明复杂业务逻辑应写入 backend actions
- **AND** 不得建议只在前端校验安全性敏感业务规则

### Requirement: 模板暴露 backend action 类型入口
模板 SHALL 提供 `@localapp/backend` 或等价本地类型入口，使 action 源码可导入 `defineAction` 和 `ctx` 类型。

#### Scenario: action 类型可编译
- **WHEN** 示例 action 从 `@localapp/backend` 导入 `defineAction`
- **THEN** TypeScript 编译 MUST 通过

#### Scenario: 前端调用 action 示例
- **WHEN** 查看示例前端代码或文档
- **THEN** MUST 包含 `client.action()` 或 `useAction()` 调用示例

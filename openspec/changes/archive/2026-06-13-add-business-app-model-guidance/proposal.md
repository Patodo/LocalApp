## Why

LocalApp 已经具备 schema、CRUD、当前用户、访问控制和 React SDK 等 P0 底座能力，但应用开发者和 AI Agent 仍需要自己把这些原语组合成“请假、审批、报销、客户管理”等业务应用模式。当前缺口集中在业务模型声明、行级所有权、权限判断 API 和 Agent 建模指引，导致应用能做出来，但容易出现数据归属、权限展示和 schema 设计不一致的问题。

## What Changes

- 新增业务应用建模能力，定义常见业务模型约定：申请类、审批类、分配类、目录类数据的推荐字段、状态字段、所有权字段和权限模式。
- 扩展 schema 管理能力，使 schema 能声明业务所有权字段、当前用户默认值、状态枚举和业务用途元数据。
- 扩展 CRUD API，使平台能够在创建记录时填充当前用户字段，并在读取、更新、删除时支持基于记录字段的行级访问控制。
- 扩展访问控制能力，在现有页面级和路由级访问控制之上增加记录级策略，覆盖“只能看自己创建的记录”“审批人可处理待审批记录”等业务场景。
- 扩展 React SDK，提供面向应用代码的权限判断 API 和组件，例如 `usePermissions()` / `can()` / `<Can>`，并保持现有 Hook 向后兼容。
- 扩展 init 模板和 Agent skill 指引，使 AI Agent 在创建业务应用时优先选择正确的数据模式、字段约定、权限策略和 UI 展示方式。
- 不移除现有 CRUD、raw SQL、pageAccess、routeAccess、shadcn/ui 能力；本变更在现有能力之上增强业务应用开发体验。

## Capabilities

### New Capabilities
- `business-app-modeling`: 定义 LocalApp 业务应用建模约定，包括常见业务数据类型、字段模式、状态模式、所有权模式、权限模式和 Agent 使用规则。

### Modified Capabilities
- `schema-management`: 增加业务模型元数据、当前用户默认值、枚举约束和所有权字段声明。
- `crud-api`: 增加当前用户字段自动填充、记录级过滤和记录级写操作权限检查。
- `access-control`: 在页面级和路由级访问控制之外增加记录级访问控制策略。
- `sdk-react`: 增加权限判断 Hook 与组件，帮助应用 UI 根据当前用户和记录状态展示可用操作。
- `init-template`: 增加业务应用建模指引、默认示例和 CLAUDE.md 入口。
- `agent-data-skill`: 增加 Agent 面向业务应用的 schema、权限、状态建模规则。

## Impact

- 影响服务端 schema 定义、meta.json 存储结构、CRUD 路由、访问控制判断和相关集成测试。
- 影响 `@localapp/sdk-react` 的导出 API，但新增能力必须向后兼容现有 Hook。
- 影响 `init-repo/` 模板文档、示例代码、`.claude/skills/` 指引和 CLI 内置模板打包测试。
- 可能需要更新 CLI schema 创建命令，使其能声明业务模型元数据或从文件读取扩展 schema 定义。
- 不引入新的外部后端服务；数据仍存储在现有页面级 SQLite 中。

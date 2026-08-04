## ADDED Requirements

### Requirement: 模板包含业务应用建模指引

`init-repo/` SHALL 包含面向 AI Agent 和应用开发者的业务应用建模指引，说明如何把 schema、当前用户、记录级权限、SDK Hook 和 shadcn/ui 组合成可用业务应用。

#### Scenario: CLAUDE.md 包含业务建模入口
- **WHEN** 阅读 `init-repo/CLAUDE.md`
- **THEN** 文档 SHALL 在深入指南或核心规则中包含业务应用建模 skill 的入口说明

#### Scenario: 业务建模 skill 文件存在
- **WHEN** 查看 `init-repo/.claude/skills/`
- **THEN** 目录 SHALL 包含业务应用建模相关 skill 文件

### Requirement: 模板示例展示业务模型和权限判断

模板默认示例 SHALL 展示业务模型字段、当前用户默认归属、列表展示、创建操作和 UI 权限判断的组合模式。

#### Scenario: 示例包含业务字段
- **WHEN** 查看 `init-repo/src/App.tsx`
- **THEN** 示例 SHALL 使用或说明 `created_by`、`status` 等业务字段模式

#### Scenario: 示例包含权限 UI 模式
- **WHEN** 查看 `init-repo/src/App.tsx`
- **THEN** 示例 SHALL 展示基于 `usePermissions()`、`can()` 或 `<Can>` 的操作展示模式

### Requirement: CLI 内置模板包含业务建模指引

CLI 编译时嵌入的内置模板 SHALL 包含业务建模 skill、更新后的 `CLAUDE.md` 和示例代码。

#### Scenario: 使用 builtin 模板初始化项目
- **WHEN** 使用 CLI 的 builtin init-repo 模板初始化应用
- **THEN** 目标项目 SHALL 包含业务建模指引文件和更新后的默认示例

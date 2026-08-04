## MODIFIED Requirements

### Requirement: Agent 系统工具使用页面级 API 路径

模板的 Agent 系统工具 SHALL NOT 重新提供通用 `queryData` 或 `listSchemas` 数据探查工具。应用数据访问 SHALL 继续通过 SDK hooks/client、registered named SQL 和应用通过 `useRegisterTools` 暴露的明确业务工具完成。模板文档 SHALL 将 `/{userId}/{name}` 描述为上传后的正式验证入口，不得要求 agent 通过 `/serve/{userId}/{name}/` 验收应用功能。

#### Scenario: 系统工具不提供 queryData
- **WHEN** 应用初始化后调用 `createSystemTools()`
- **THEN** 返回的系统工具列表 SHALL NOT 包含 `queryData`
- **AND** 应用如需让 Agent 查询业务数据 SHALL 注册受控的业务工具

#### Scenario: 系统工具不提供 listSchemas
- **WHEN** 应用初始化后调用 `createSystemTools()`
- **THEN** 返回的系统工具列表 SHALL NOT 包含 `listSchemas`
- **AND** schema 信息 SHALL 通过应用代码、SDK 类型或明确注册的业务工具按需暴露

#### Scenario: 上传后验证使用正式 Shell route
- **WHEN** 应用上传后需要验收用户可见功能
- **THEN** 模板文档 SHALL 指示访问 `/{userId}/{name}`
- **AND** 模板文档 SHALL NOT 将 `/serve/{userId}/{name}/` 描述为默认功能验收入口

## ADDED Requirements

### Requirement: 模板和 skill 使用正式应用入口进行验收

init-repo 模板文档、内置 agent skill、应用协作说明和 E2E 指引 SHALL 在“上传后验证应用”场景中使用 `/{userId}/{name}`。如需提及 `/serve/{userId}/{name}/`，必须明确标注为内部 raw app resource/API base 或底层调试路径。

#### Scenario: CLAUDE.md 指向正式入口
- **WHEN** 开发者查看 `init-repo/CLAUDE.md` 的上传后验证步骤
- **THEN** 文档 SHALL 指示访问 `http://localhost:3000/{userId}/{name}`
- **AND** 文档 SHALL NOT 指示使用 `/serve/{userId}/{name}/` 作为默认验收入口

#### Scenario: 应用协作 skill 指向正式入口
- **WHEN** 平台侧 session 向应用侧 session 下发验证任务
- **THEN** 任务 SHALL 要求应用侧在 `/{userId}/{name}` 验证用户可见功能
- **AND** 只有资源/API 诊断任务 MAY 访问 `/serve/{userId}/{name}/`

#### Scenario: CLI 输出正式 URL
- **WHEN** `localapp upload` 或页面信息命令展示应用访问地址
- **THEN** 默认用户可访问 URL SHALL 为 `/{userId}/{name}`
- **AND** 如果展示 `/serve/{userId}/{name}/`，该字段 SHALL 被标注为 internal raw resource/API URL

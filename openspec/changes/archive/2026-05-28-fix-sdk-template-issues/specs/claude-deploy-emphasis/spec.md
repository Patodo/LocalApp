## ADDED Requirements

### Requirement: CLAUDE.md 包含醒目的部署工作流章节

`init-repo/CLAUDE.md` SHALL 在「平台概述」之后、所有能力介绍之前，包含「开发工作流」章节。该章节 SHALL 明确列出每次代码修改后必须执行的部署步骤，并使用醒目标记强调其必要性。

#### Scenario: 部署章节位置
- **WHEN** 阅读 CLAUDE.md 文档
- **THEN** 「开发工作流」章节位于「平台概述」之后、第一个能力章节（「数据 CRUD API」）之前

#### Scenario: 部署步骤内容
- **WHEN** 阅读「开发工作流」章节
- **THEN** 章节列出步骤：`npm run build` → `localapp upload`，并包含明确说明「构建后必须执行 upload，否则修改不会生效」

#### Scenario: Agent 优先看到部署步骤
- **WHEN** AI Agent 阅读 CLAUDE.md 的前 100 行
- **THEN** 部署工作流章节已出现在可见范围内

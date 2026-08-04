## ADDED Requirements

### Requirement: CLAUDE.md 包含醒目的部署工作流章节

`init-repo/CLAUDE.md` SHALL 在「平台概述」之后、所有能力介绍之前，包含「开发工作流」章节。该章节 SHALL 列出 `npm run build` 和 `localapp upload` 两个步骤，并明确标注「构建后必须执行 upload」的强制性说明。

#### Scenario: 部署章节位置
- **WHEN** 阅读 CLAUDE.md 文档
- **THEN** 「开发工作流」章节为文档的第二个一级章节（紧接「平台概述」之后）

#### Scenario: 部署步骤内容
- **WHEN** 阅读「开发工作流」章节
- **THEN** 章节包含 `npm run build` 和 `localapp upload` 两个步骤，以及「**构建后必须执行** upload」的强调说明

#### Scenario: 表单可访问性规范
- **WHEN** 阅读 CLAUDE.md 中的表单代码示例
- **THEN** 示例中的 `<label>` 使用 `htmlFor` 属性关联到对应 `<input>` 的 `id`

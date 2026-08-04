## ADDED Requirements

### Requirement: 模板 Skills 包含图片上传指引

`init-repo/.claude/skills/` SHALL 包含图片上传相关的开发指引文件，说明如何使用 `useUpload` hook、支持的文件类型、大小限制，以及在表单中集成图片上传的完整示例。

#### Scenario: Skills 文件存在
- **WHEN** 查看 `init-repo/.claude/skills/` 目录
- **THEN** 包含图片上传相关的 skill 文件（如 `localapp-upload.md`）

#### Scenario: Skill 包含完整示例
- **WHEN** AI Agent 阅读 upload skill
- **THEN** 文档包含 `useUpload` 的 TypeScript 示例代码，展示在表单中上传图片并将 key 存入数据记录的完整流程

#### Scenario: Skill 包含限制说明
- **WHEN** AI Agent 阅读 upload skill
- **THEN** 文档说明支持的文件类型（png、jpg、jpeg、gif、webp、svg）和 10MB 大小限制

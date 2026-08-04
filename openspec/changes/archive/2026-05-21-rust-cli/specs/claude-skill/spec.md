## ADDED Requirements

### Requirement: localapp skill 定义

项目 SHALL 在 `.claude/skills/localapp.md` 中提供 Claude Code skill，指导 AI 使用 `localapp` CLI 工具和 HTTP API 操作 LocalApp。

#### Scenario: skill 包含 CLI 用法
- **WHEN** AI 读取 `.claude/skills/localapp.md`
- **THEN** skill 包含所有 CLI 命令的用法说明、参数格式、输出格式

#### Scenario: skill 包含项目识别逻辑
- **WHEN** AI 需要操作某个项目
- **THEN** skill 指导 AI 先读取 `.localapp.json` 获取 pageId，再调用 CLI 命令

#### Scenario: skill 包含初始化流程
- **WHEN** 用户首次请求上传项目
- **THEN** skill 指导 AI 执行 `localapp new` + `localapp upload` 完成初始化

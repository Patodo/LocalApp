## MODIFIED Requirements

### Requirement: 核心 Skill 升级
现有 `.claude/skills/localapp.md` SHALL 升级为包含完整项目识别逻辑和部署流程的核心 skill。

#### Scenario: skill 包含 manifest.json 项目识别
- **WHEN** AI 需要识别一个 LocalApp 项目
- **THEN** skill 指导 AI 检查 `manifest.json` 是否存在，读取 name、distDir、db 配置

#### Scenario: skill 包含完整部署流程
- **WHEN** AI 需要指导用户部署
- **THEN** skill 包含完整流程：`localapp init` → `npm run dev` → `npm run build` → `localapp upload`

#### Scenario: skill 包含 Guardrails
- **WHEN** AI 使用 LocalApp skill
- **THEN** skill 包含安全约束：不上传 src/、node_modules/、.env；schema 变更不需要重新 upload；Raw SQL 模式需要 manifest.json 设置 db.mode=sql

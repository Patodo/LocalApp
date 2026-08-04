## Purpose

Claude Code skill 定义。提供 localapp CLI 用法指南，使 AI Agent 能通过 skill 自主完成页面上传、数据管理等操作。

## Requirements

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

#### Scenario: skill 包含 CLI 用法
- **WHEN** AI 读取 `.claude/skills/localapp.md`
- **THEN** skill 包含所有 CLI 命令的用法说明、参数格式、输出格式

#### Scenario: skill 包含项目识别逻辑
- **WHEN** AI 需要操作某个项目
- **THEN** skill 指导 AI 先读取 `.localapp.json` 获取 pageId，再调用 CLI 命令

#### Scenario: skill 包含初始化流程
- **WHEN** 用户首次请求上传项目
- **THEN** skill 指导 AI 执行 `localapp new` + `localapp upload` 完成初始化

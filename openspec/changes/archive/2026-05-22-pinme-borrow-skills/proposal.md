## Why

PinMe 项目通过 5 个 Claude Code Skill 文件实现了 AI Agent 深度集成——Agent 能自主完成项目创建、部署、数据管理等全流程。LocalApp 目前只有 1 个基础 skill（`localapp.md`）和模板内的 `CLAUDE.md`，缺少对 SDK Hook、Raw SQL、权限配置等核心能力的指导，导致 Agent 无法充分利用平台能力。同时 `init-repo/CLAUDE.md` 缺少 Raw SQL / `useExec` 文档，与实际 SDK 能力不同步。

## What Changes

- 升级现有 `.claude/skills/localapp.md`，补充项目识别逻辑、部署流程、Guardrails
- 新增 `.claude/skills/localapp-data.md`，覆盖 Schema CRUD + Raw SQL 双模式、所有 SDK 数据 Hook 用法
- 新增 `.claude/skills/localapp-auth.md`，覆盖 useMe、登录跳转、页面级/路由级访问控制配置
- 更新 `init-repo/CLAUDE.md`，补充 `useExec()` Hook 文档、`db.mode` 配置说明、SQL 模式 vs CRUD 模式选择指南

## Capabilities

### New Capabilities

- `agent-data-skill`: AI Agent 数据操作指导 skill，覆盖 Schema CRUD 模式和 Raw SQL 模式的用法、SDK Hook 参考和选择指南
- `agent-auth-skill`: AI Agent 认证权限指导 skill，覆盖用户身份查询、登录跳转、双层访问控制配置

### Modified Capabilities

- `claude-skill`: 升级现有核心 skill 的项目识别逻辑和部署流程指导
- `init-template`: 补充 Raw SQL / useExec 文档到模板 CLAUDE.md

## Impact

- `.claude/skills/` 新增 2 个 skill 文件，修改 1 个现有 skill 文件
- `init-repo/CLAUDE.md` 增加文档章节
- 无代码改动，无 API 变更，无依赖变化

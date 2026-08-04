## Context

PinMe 项目在 `.claude/skills/` 下放置 5 个 skill 文件（pinme、pinme-llm、pinme-auth、pinme-email、pinme-share），让 AI Agent 能理解项目结构并自主完成开发+部署。LocalApp 目前有 1 个基础 skill（`localapp.md`）和模板内的 `CLAUDE.md`，但缺少对数据操作、认证权限等核心能力的指导。

现有 skill 覆盖：
- `localapp.md`：CLI 命令（login/new/upload/schemas/pages），基础项目识别

缺失覆盖：
- SDK Hook 用法（useList/useCreate/useExec 等 8 个 Hook）
- Raw SQL 模式（db.mode=sql + useExec）
- 认证与权限配置（useMe、redirectToLogin、pageAccess、routeAccess）
- 部署流程的完整指导

## Goals / Non-Goals

**Goals:**
- 让 AI Agent 能自主完成"用户描述需求 → Agent 生成代码 → 部署上线"全流程
- Skill 文件结构与 PinMe 对齐（frontmatter + Markdown 参考文档）
- init-repo/CLAUDE.md 与 SDK 实际能力保持同步

**Non-Goals:**
- 不新增 LLM/邮件等平台服务（后续变更）
- 不修改任何代码逻辑
- 不修改 SDK 或 CLI 行为

## Decisions

### 1. Skill 拆分粒度：按能力域拆分

沿用 PinMe 的"一个能力域一个 skill"模式，而非把所有内容塞进一个文件。

选择 `localapp`（核心）+ `localapp-data`（数据）+ `localapp-auth`（认证）三个 skill，而非 5 个（PinMe 有 llm/email 两个额外 skill，对应平台服务代理，LocalApp 暂无这些能力，后续新增）。

### 2. Skill 触发方式：description 字段匹配

每个 skill 文件用 YAML frontmatter 的 `description` 字段声明触发条件。Agent 通过语义匹配选择合适的 skill。

### 3. CLAUDE.md 内容：补充而非重写

`init-repo/CLAUDE.md` 已有完整的 CRUD Hook 文档和错误处理指南，只缺少 Raw SQL / useExec 部分。在现有结构末尾追加新章节，保持文档连贯性。

## Risks / Trade-offs

- [Skill 文件不随 SDK 更新自动同步] → 每次 SDK 新增 Hook 或修改 API 时，需同步更新对应 skill 文件。通过在 tasks 中标注"SDK 变更时同步"来提醒。
- [description 触发可能不够精确] → 这与 PinMe 面临的问题相同，目前没有更好的解决方案，依赖 LLM 的语义理解能力。

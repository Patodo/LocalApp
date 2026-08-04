## Context

当前 LocalApp 的开发体验存在 10 个已识别的摩擦点，从环境搭建到 SDK 文档覆盖均有差距。这些问题的修复不涉及架构变更或新依赖，属于低风险的增量改进。核心约束是：CLI 侧（Rust）和 Server 侧（TypeScript）分属不同技术栈，需分别处理。

## Goals / Non-Goals

**Goals:**
- 新人（或 Agent）可以在 3 步内启动 server 并初始化第一个项目
- CLI 参数命名兼容直觉（下划线和连字符均可用）
- Schema 创建支持从文件读取，避免命令行过长 JSON
- init-repo CLAUDE.md 覆盖所有公开的 SDK API
- 主项目 CLAUDE.md 中的命令与 package.json scripts 一致

**Non-Goals:**
- 不涉及 LLM 后端 mock 或 fallback（那是独立功能）
- 不涉及 CI/CD 流水线变更
- 不涉及 MinIO 或文件存储架构变更
- 不改变现有 API 契约（TEMPLATE_REPO_URL 的 API 行为不变，仅校验时机前移）

## Decisions

### 1. TEMPLATE_REPO_URL 校验前移

**方案**：去掉 `loadConfig()` 中的硬校验。当 TEMPLATE_REPO_URL 为空时，`GET /api/config` 返回空字符串。CLI 端（`init.rs:206-214`）检测到空 URL 后自动回退到内置模板。

**替代方案（已否决）**：在 server 端新增 HTTP 400 校验（"Remote template not available"）。否决原因：CLI 已有 fallback 逻辑，server 端加校验不增值且增加维护面。客户端降级比服务端报错更友好。

**选择理由**：最小改动，不破坏现有 API 行为。`GET /api/config` 仍返回 `templateRepoUrl` 字段（可能为空字符串），CLI 已有 fallback 逻辑处理空 URL 的情况。

### 2. CLI alias 而非改名

**方案**：在 `main.rs` 的 `builtin_repo` 字段上加 `#[arg(alias = "builtin_repo")]`，保持 `--builtin-repo` 为主名。

**替代方案（已否决）**：把字段直接改成 kebab-case 声明。否决原因：Rust 命名惯例是 snake_case，直接改名会破坏代码可读性。alias 是不增加复杂度的最优解。

### 3. `schemas create --file` 互斥关系

**方案**：`--file` 和 `--fields` 互斥，不能同时使用。如果同时指定，报错提示二选一。

```rust
#[arg(long, conflicts_with = "fields")]
file: Option<String>,
```

实现逻辑：读取文件内容 → `serde_json::from_str` 解析 → 与 `--fields` 走同一后续路径。

**选择理由**：简单清晰，与现有 CLI 逻辑复用。

### 4. .env.example 内容范围

**方案**：只列出开发必需的环境变量及其默认值，不含生产或 CI 专用变量。

```bash
# LocalApp 开发环境配置
DATA_DIR=../../data
JWT_SECRET=dev-jwt-secret-change-me
BOOTSTRAP_API_KEY=dev-api-key-change-me
# 可选：远程模板仓库 URL（不设置则使用内置模板）
# TEMPLATE_REPO_URL=https://github.com/example/template.git
```

**选择理由**：最小化配置负担，TEMPLATE_REPO_URL 注释掉表示可选。

### 5. CLAUDE.md 补充 useUpload 文档位置

**方案**：在 init-repo CLAUDE.md 的 SDK 参考章节中，`useCount` 和 `useExec` 之间插入 `useUpload` 文档段落，并新增"文件上传 + 表单"组合模式示例。

## Risks / Trade-offs

| 风险 | 概率 | 缓解 |
|------|------|------|
| TEMPLATE_REPO_URL 未配置时 `/api/config` 返回空 URL，旧版 CLI 可能在收到空 URL 时行为异常 | 低 | CLI 已有 fallback 逻辑（`prepare_template_git` 失败 → builtin），空 URL 相当于 "不可用"，行为一致 |
| `--builtin_repo` alias 让 CLI help 文本变长 | 极低 | 一个 alias 对帮助文本影响可忽略 |
| `.env.example` 中的默认 secret 被误用到生产 | 低 | 文件名已含 `example`，注释标明 dev 专用 |

## Migration Plan

无需数据迁移。所有改动向后兼容：

1. **Server**: TEMPLATE_REPO_URL 不填仍可启动。已有配置不受影响。
2. **CLI**: 新参数 + alias 纯增量。已有命令不变。
3. **init-repo CLAUDE.md**: 纯文档追加，已有内容不变。
4. **主 CLAUDE.md**: 补充 `npm run dev:server`（与 `npm run dev` 并存），两种写法都说明。

部署顺序：先部署 server（TEMPLATE_REPO_URL 选填）→ 再发布 CLI → 最后更新模板仓库。

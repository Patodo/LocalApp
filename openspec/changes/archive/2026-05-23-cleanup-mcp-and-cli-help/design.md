## Context

项目最初设计为 MCP 服务器，后改为 CLI + HTTP API 实现。代码库中残留了 MCP 相关的类型定义（`packages/server/src/types/mcp.ts`）、npm 依赖（`@modelcontextprotocol/sdk`）以及多处规格和文档中的 MCP 描述。这些残留对新加入的开发者造成误导。

CLI 基于 Rust clap，使用 `///` doc comment 生成帮助文本。当前所有描述为英文且偏技术化（如提到 manifest.json），与面向中文用户的产品定位不一致。

## Goals / Non-Goals

**Goals:**
- 清除活跃代码和规格中所有 MCP 残留
- CLI help 文本中文化，描述面向用户而非面向开发者
- 顶层 about 提供一句话工具用途说明
- 补齐安全与授权边界 E2E 测试

**Non-Goals:**
- 不清理归档的变更历史（archive）和 idea.md（属于项目记忆）
- 不清理 worktree（`.wts/`）中的内容
- 不修改 CLI 的命令结构或参数逻辑，只改帮助文本
- 不删除 `docs/plan.md` 整个文件（只移除 MCP 相关段落）
- 不增加并发测试（需要专门的测试基础设施，独立处理）
- 不增加限流/CORS（代码中不存在这些功能）

## Decisions

### 1. MCP 类型文件处理：直接删除

`mcp.ts` 定义了 UploadPageParams、CreateSchemaParams 等 MCP Tool 类型。经确认，这些类型没有任何运行时代码引用（grep 验证），仅作为"预留接口"存在。直接删除文件。

### 2. CLI help 语言：中文

clap 支持在 `///` doc comment 中写中文，生成的 `--help` 输出自动使用中文。选择中文与项目的 UI 语言（Profile SPA、Admin SPA 均为中文）保持一致。

### 3. CLI 描述风格：面向用户

将技术实现细节（manifest.json、API 路径）从帮助文本中移除，改为描述用户能做什么。

- Before: `Initialize a new project with manifest.json`
- After: `创建新项目（含模板下载、依赖安装、首次部署）`

### 4. 活跃规格清理：直接编辑

`openspec/specs/shared-types/spec.md` 和 `openspec/specs/monorepo-structure/spec.md` 中的 MCP 引用直接编辑移除，不创建 delta spec（因为这是清理历史遗留，不是需求变更）。

### 5. 测试缺口补充策略：按风险分组

安全与授权边界测试按优先级分为两组，统一放入新的测试文件 `packages/server/tests/e2e/security-boundary.test.ts`：

- **授权边界**：非 owner PUT/DELETE pages（403）、页面级 acl 模式 E2E
- **注入防御**：CRUD filter SQL 注入、上传 HTML XSS（验证 CSP）
- **上传限制**：50MB 单次上限（413）、缺失必填字段（400）
- **缺失字段**：POST pages 无 name、GET/DELETE schemas 无 pageName

不测 500MB 用户配额（需要大量数据准备，ROI 低）和并发（需要专门基础设施）。

## Risks / Trade-offs

- [中文 help 对非中文用户不友好] → 项目定位为中文用户，可接受。若后续需要国际化再处理。
- [50MB 测试需要构造大文件] → 用 `Buffer.alloc()` 生成，测试本身不慢。

## Why

项目最初设计为 MCP 服务器，后改为 CLI 实现。代码库中残留大量 MCP 相关内容（类型定义、依赖包、规格描述），对维护者造成误导。同时 CLI help 文本全英文且描述过于技术化（暴露 manifest.json 等实现细节），与面向中文用户的 UI 不一致。此外 E2E 测试覆盖分析发现安全与授权边界存在缺口，需要补齐。

## What Changes

- 移除 `packages/server/src/types/mcp.ts` 文件（MCP Tool 参数类型定义，已无引用方）
- 移除 `packages/server/package.json` 中的 `@modelcontextprotocol/sdk` devDependency
- 清理 `openspec/specs/shared-types/spec.md` 中的 "MCP Tool 类型定义" 需求
- 清理 `openspec/specs/monorepo-structure/spec.md` 中对 `mcp.ts` 文件的引用
- 清理 `docs/plan.md` 中的 MCP 架构描述
- 优化 CLI help 文本：将所有命令描述改为中文，移除实现细节，添加顶层 about 说明工具用途
- 补齐 E2E 测试缺口：安全注入、授权边界、上传限制、缺失字段

## Capabilities

### New Capabilities

（无新增能力）

### Modified Capabilities

- `cli-tool`: 优化 CLI help 文本，所有命令和参数描述改为中文，补充顶层 about 说明
- `e2e-cli-test-framework`: 补齐安全与授权边界测试（SQL 注入、XSS、非 owner 操作、上传限制、缺失字段）

## Impact

- `packages/server/src/types/mcp.ts` — 删除
- `packages/server/package.json` — 移除 devDependency
- `openspec/specs/shared-types/spec.md` — 移除 MCP Tool 需求段落
- `openspec/specs/monorepo-structure/spec.md` — 移除 mcp.ts 引用
- `docs/plan.md` — 移除 MCP 相关段落
- `packages/cli/src/main.rs` — 修改所有 clap doc comment 为中文
- `packages/server/tests/e2e/` — 新增安全与边界测试用例

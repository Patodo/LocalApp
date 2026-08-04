## 1. MCP 残留清理

- [x] 1.1 删除 `packages/server/src/types/mcp.ts` 文件
- [x] 1.2 从 `packages/server/package.json` 移除 `@modelcontextprotocol/sdk` devDependency，执行 `pnpm install`
- [x] 1.3 编辑 `openspec/specs/shared-types/spec.md`，移除 "MCP Tool 类型定义" 需求段落
- [x] 1.4 编辑 `openspec/specs/monorepo-structure/spec.md`，移除对 `mcp.ts` 的引用
- [x] 1.5 清理 `docs/plan.md` 中的 MCP 架构描述段落

## 2. CLI Help 文本中文化

- [x] 2.1 修改 `packages/cli/src/main.rs` 顶层 `about` 为中文一句话描述
- [x] 2.2 修改 `Init` 命令的 doc comment 为中文（命令描述 + name/description/skip_deploy 参数描述）
- [x] 2.3 修改 `Login` 命令的 doc comment 为中文
- [x] 2.4 修改 `New` 命令的 doc comment 为中文
- [x] 2.5 修改 `Upload` 命令的 doc comment 为中文（含 path 参数描述）
- [x] 2.6 修改 `Pages` 命令和子命令（List/Info/Delete）的 doc comment 为中文
- [x] 2.7 修改 `Schemas` 命令和子命令（Create/List/Delete）的 doc comment 为中文（含 fields 参数描述）
- [x] 2.8 修改 `Update` 命令的 doc comment 为中文
- [x] 2.9 修改 `Admin` 命令和子命令（Users/Pages/Stats）的 doc comment 为中文
- [x] 2.10 编译 CLI 验证 `--help` 输出为中文且格式正确

## 3. 安全与授权边界测试

- [x] 3.1 创建 `packages/server/tests/e2e/security-boundary.test.ts`，编写 CRUD filter SQL 注入测试
- [x] 3.2 编写上传 HTML 含 XSS 脚本的 CSP 验证测试
- [x] 3.3 编写非 owner PUT/DELETE 其他用户页面的 403 测试
- [x] 3.4 编写页面级 acl 模式的 E2E 测试（拒绝非列表用户 + 允许列表内用户）
- [x] 3.5 编写单次上传超过 50MB 的 413 测试
- [x] 3.6 编写 POST /api/pages 缺少 name 的 400 测试
- [x] 3.7 编写 GET/DELETE /api/schemas 缺少 pageName 的 400 测试
- [x] 3.8 编写 POST /api/schemas 缺少 fields 的错误测试
- [x] 3.9 运行全部 E2E 测试确认通过

## 4. 验证

- [x] 4.1 运行 `pnpm install` 确认依赖清理无误
- [x] 4.2 全文搜索确认活跃代码和规格中无 MCP 残留

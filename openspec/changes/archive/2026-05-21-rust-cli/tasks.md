## 1. 清理旧代码

- [x] 1.1 删除 `packages/mcp-client` 下所有 TypeScript 源文件（保留目录）
- [x] 1.2 删除 `packages/server/tests/e2e/mcp/` 测试目录
- [x] 1.7 提交清理

## 2. 服务端新增 POST /api/pages

- [x] 2.1 在 `packages/server/src/routes/pages.ts` 中添加 `POST /api/pages` 路由：生成 pageId，创建目录和 meta.json，返回 pageId 和 url
- [x] 2.2 编写 `POST /api/pages` 的 e2e 测试（成功创建、未认证返回 401）
- [x] 2.3 运行全部 e2e 测试确认通过
- [x] 2.4 提交服务端变更

## 3. Rust CLI 项目初始化

- [x] 3.1 在 `packages/mcp-client/` 下初始化 Cargo 项目（`cargo init`）
- [x] 3.2 配置 `Cargo.toml` 依赖：clap、reqwest（multipart feature）、serde、serde_json、tokio、dialoguer
- [x] 3.3 创建项目结构：`src/main.rs`、`src/config.rs`、`src/client.rs`、`src/project.rs`、`src/commands/mod.rs`
- [x] 3.4 实现 `config.rs`：读写 `~/.localapp/work/config.json`，环境变量覆盖逻辑
- [x] 3.5 实现 `project.rs`：读写当前目录 `.localapp.json`
- [x] 3.6 实现 `client.rs`：HTTP 客户端封装（GET/POST/DELETE + multipart upload）
- [x] 3.7 确认 `cargo build` 成功
- [x] 3.8 提交项目初始化

## 4. 实现 CLI 命令

- [x] 4.1 实现 `login` 命令：交互式输入 serverUrl 和 apiKey，保存到 config
- [x] 4.2 实现 `new` 命令：POST /api/pages，写 .localapp.json，输出 JSON
- [x] 4.3 实现 `upload <path>` 命令：读 .localapp.json，递归读目录文件，multipart POST /api/upload
- [x] 4.4 实现 `pages list`、`pages info`、`pages delete` 子命令
- [x] 4.5 实现 `schemas create`、`schemas list`、`schemas delete` 子命令
- [x] 4.6 所有命令的 pageId 参数逻辑：upload 强制读 .localapp.json，其他命令可选 --page-id 覆盖
- [x] 4.7 错误处理：统一 JSON 错误输出到 stderr，非 0 退出码
- [x] 4.8 手动测试所有命令
- [x] 4.9 提交 CLI 实现

## 5. Claude Code Skill

- [x] 5.1 创建 `.claude/skills/localapp.md` skill 文件
- [x] 5.2 skill 包含：CLI 命令用法、项目识别逻辑（.localapp.json）、初始化流程
- [x] 5.3 提交 skill

## 6. 更新 pnpm workspace 配置

- [x] 6.1 从 `pnpm-workspace.yaml` 中移除 `packages/mcp-client`（不再需要 pnpm 管理）
- [x] 6.2 确认 `pnpm install` 和 `pnpm -r build` 正常
- [x] 6.3 提交配置变更

## Purpose

This spec describes the expected behavior, acceptance criteria, and integration boundaries for the dev-quickstart capability in LocalApp.
## Requirements

### Requirement: 根 package.json 提供默认 dev 脚本

项目根目录的 `package.json` SHALL 包含 `dev` 脚本，作为开发服务器的默认入口。脚本 SHALL 等价于 `npm run dev:server`（即 `pnpm -C packages/server dev`）。

#### Scenario: 使用默认 dev 脚本启动 server
- **WHEN** 在项目根目录执行 `npm run dev`
- **THEN** server 启动，行为与 `npm run dev:server` 完全一致

### Requirement: 提供 .env.example 开发环境配置模板

项目根目录 SHALL 包含 `.env.example` 文件，列出开发所需的环境变量及其说明。必填变量 SHALL 提供示例值，可选变量 SHALL 以注释形式呈现。

#### Scenario: .env.example 包含必填变量
- **WHEN** 查看 `.env.example`
- **THEN** 包含 `DATA_DIR`、`JWT_SECRET`、`BOOTSTRAP_API_KEY` 的示例值

#### Scenario: .env.example 中 TEMPLATE_REPO_URL 以注释呈现
- **WHEN** 查看 `.env.example`
- **THEN** `TEMPLATE_REPO_URL` 行以 `#` 注释，表示可选

### Requirement: 主项目 CLAUDE.md 测试步骤命令准确

主项目的 `CLAUDE.md` SHALL 包含正确可执行的 server 启动命令。`npm run dev` 和 `npm run dev:server` 两种写法均应可用，且至少提及一种。

#### Scenario: CLAUDE.md 启动命令可执行
- **WHEN** 开发者按 CLAUDE.md 中的命令启动 server
- **THEN** server 正常启动，不报 "Missing script" 错误

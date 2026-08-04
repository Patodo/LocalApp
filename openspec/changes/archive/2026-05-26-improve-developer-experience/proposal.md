## Why

通过一次完整的"初始化 → 开发 → 部署 → 验证"端到端测试（开发 Bug 上报应用），发现了 10 个摩擦点。这些问题导致新人上手耗时超过必要水平，Agent 开发额外消耗约 40% 的 token 用于反向探索而非实际编码。核心矛盾是 SDK 能力大于文档覆盖度，以及本地开发环境的启动门槛过高。

## What Changes

- 根 package.json 增加 `dev` 默认脚本，消除 CLAUDE.md 与实际脚本名不一致的问题
- **BREAKING**: 将 `TEMPLATE_REPO_URL` 从启动必填改为选填，仅在非 builtin 模式克隆模板时按需校验
- CLI `--builtin-repo` 增加 `builtin_repo` alias，兼容两种写法
- CLI `schemas create` 增加 `--file` 参数，支持从 JSON 文件读取字段定义
- 根目录增加 `.env.example`，列出开发所需的环境变量及其说明
- init-repo 的 CLAUDE.md 补充 `useUpload` Hook 文档和截图上传模式
- 修正主项目 CLAUDE.md 中的错误命令（`npm run dev` → `npm run dev:server`）

## Capabilities

### New Capabilities

- `dev-quickstart`: 开发环境快速启动能力 — 提供 .env.example、`npm run dev` 默认脚本、一键初始化流程文档

### Modified Capabilities

- `server-config`: TEMPLATE_REPO_URL 从启动必填降级为按需校验 — 仅在使用远程模板克隆时才要求配置
- `cli-tool`: `--builtin-repo` 增加下划线 alias；`schemas create` 新增 `--file` 参数
- `init-template`: CLAUDE.md 增加 `useUpload` Hook 文档和文件上传使用模式

## Impact

- **Server**: `lib/config.ts` 去掉 TEMPLATE_REPO_URL 的硬校验，改在 template download handler 按需检查
- **CLI**: `main.rs` 增加 alias，`schemas.rs` 增加 `--file` 参数解析
- **Root**: `package.json` 增加 `dev` 脚本，新增 `.env.example`
- **init-repo**: `CLAUDE.md` 增加 useUpload 文档段落
- **主项目 CLAUDE.md**: 修正测试步骤中的命令

## Purpose

This spec describes the expected behavior, acceptance criteria, and integration boundaries for the cli-builtin-template capability in LocalApp.
## Requirements
### Requirement: CLI 编译时打包 init-repo 模板
CLI 二进制 SHALL 在编译时通过 `include_dir!` 将 init-repo 模板源码嵌入。build.rs SHALL 在编译前将 init-repo 复制到 `target/init-repo-staging/`（排除 `node_modules/`、`dist/`、`.next/`），并将 `INIT_REPO_DIR` 指向 staging 目录。解压范围 SHALL 排除 `node_modules/` 和 `dist/` 目录。

#### Scenario: 编译成功包含模板
- **WHEN** 执行 `cargo build` 编译 CLI
- **THEN** 生成的二进制包含 init-repo 源码文件（package.json, vite.config.ts, src/ 等），不包含 node_modules/

#### Scenario: 编译时模板目录不存在
- **WHEN** `init-repo/` 目录不存在或路径配置错误
- **THEN** 编译失败并给出明确错误信息

#### Scenario: Staging 目录自动清理
- **WHEN** 执行 `cargo clean`
- **THEN** `target/init-repo-staging/` 被完全移除

### Requirement: 内置模板解压到目标目录
CLI SHALL 将内置模板分为「用户领地」和「CLI 领地」两部分分别解压到用户指定的目标目录。解压后 SHALL 写入 `manifest.json`（含 name、description、distDir）和只含临时连接上下文的 `.localapp/dev-config.json`（初始化时含 `serverUrl`）。持久 `autoSync`/`ejected` 策略 SHALL 由 `.localapp/project-config.json` 承载；默认策略无需创建该文件。

「用户领地」包括：`manifest.json`、`package.json`、`vite.config.ts`、`tsconfig.json`、`vitest.config.ts`、`postcss.config.js`、`components.json`、`index.html`、`CLAUDE.md`、`.gitignore`、`src/main.tsx`、`src/App.tsx`、`src/index.css`、`src/components/ui/*`、`tests/`。

「CLI 领地」包括：`.localapp/runtime/`、`.claude/skills/localapp*/`、`.claude/skills/agent-tool-patterns/`。

「CLI 领地」解压后 SHALL 写入 `.localapp/runtime/version.json`，内容为 `{"cliVersion": "<当前CLI版本>"}`。

#### Scenario: 解压内置模板
- **WHEN** 执行 `localapp init --name my-app --source builtin`
- **THEN** 目标目录包含用户领地文件（package.json, vite.config.ts, src/main.tsx 等）和 CLI 领地（.localapp/runtime/、.claude/skills/localapp-*/），不含 node_modules 和 dist

#### Scenario: 目标目录已存在
- **WHEN** 执行 `localapp init --name my-app` 且目标目录已存在
- **THEN** 返回错误 "Directory 'my-app' already exists"

#### Scenario: 解压后 version.json 标记当前 CLI 版本
- **WHEN** CLI 版本 0.5.0 时执行 `localapp init --name my-app`
- **THEN** `my-app/.localapp/runtime/version.json` 内容为 `{"cliVersion": "0.5.0"}`

#### Scenario: 用户领地与 CLI 领地分离
- **WHEN** 检查 `localapp init` 后的项目结构
- **THEN** `src/App.tsx`、`tests/`、`manifest.json` 等位于用户领地（项目根或 src/、tests/）；DevShell、vite-plugin、SDK 等位于 `.localapp/runtime/`；skills 位于 `.claude/skills/localapp-*/`

### Requirement: init-repo 路径可通过环境变量配置
构建系统 SHALL 支持通过 `INIT_REPO_DIR` 环境变量指定 init-repo 目录路径。默认行为 SHALL 自动将 init-repo 复制到 `target/init-repo-staging/` 并指向 staging 目录。

#### Scenario: 使用默认路径
- **WHEN** 未设置 `INIT_REPO_DIR` 环境变量
- **THEN** build.rs 自动复制 init-repo（排除 node_modules/dist/.next）到 `target/init-repo-staging/`，并设置 `INIT_REPO_DIR` 指向 staging 目录

#### Scenario: 使用自定义路径
- **WHEN** 设置 `INIT_REPO_DIR=/path/to/custom-template`
- **THEN** 从指定路径复制到 staging 目录并嵌入

### Requirement: 内置模板解压后后处理依赖

CLI SHALL 在提取内置模板后，执行依赖后处理步骤：将 SDK 包源码拷贝到目标项目 `.localapp/runtime/sdk/{core,react,agent}/` 目录，并修改用户 `package.json` 将 `workspace:*` 替换为 `file:./.localapp/runtime/sdk/{core,react,agent}` 引用。

用户 `package.json` SHALL 注入 `"@localapp/app-kit": "file:./.localapp/runtime"` 引用（用于 vite-plugin、DevShell、tsconfig.base 等的导入解析）。

用户 `package.json` SHALL 注入 postinstall 钩子 `"postinstall": "localapp sync --quiet 2>/dev/null || true"`，确保 clone 后自动 sync。

#### Scenario: workspace:* 替换为 file 引用

- **WHEN** 执行 `localapp init --name my-app` 提取内置模板
- **THEN** 目标项目 `package.json` 中 `@localapp/sdk` 的值为 `"file:./.localapp/runtime/sdk/core"`，`@localapp/sdk-react` 的值为 `"file:./.localapp/runtime/sdk/react"`，`@localapp/sdk-agent` 的值为 `"file:./.localapp/runtime/sdk/agent"`，`@localapp/app-kit` 的值为 `"file:./.localapp/runtime"`

#### Scenario: runtime/sdk 目录包含 SDK 源码

- **WHEN** 模板提取完成后
- **THEN** 目标项目存在 `.localapp/runtime/sdk/core/src/`、`.localapp/runtime/sdk/react/src/`、`.localapp/runtime/sdk/agent/src/` 目录，包含对应 SDK 包的完整源码和 `package.json`

#### Scenario: npm install 成功

- **WHEN** 在目标项目目录执行 `npm install`
- **THEN** 安装成功，无 `EUNSUPPORTEDPROTOCOL` 错误，`node_modules/@localapp/*` 通过 file: 引用指向 runtime

#### Scenario: SDK 包中无残留 workspace:* 引用

- **WHEN** `.localapp/runtime/sdk/` 中的 SDK `package.json` 包含 `workspace:*` peerDependencies
- **THEN** CLI 后处理步骤 SHALL 将 runtime/sdk 内所有 `package.json` 中的 `workspace:*` 替换为对应版本号 `*`

#### Scenario: package.json 包含 postinstall 钩子

- **WHEN** 模板提取完成后
- **THEN** 用户 `package.json` 的 `scripts` 字段包含 `"postinstall": "localapp sync --quiet 2>/dev/null || true"`

### Requirement: 内置模板编译期 staging 包含 runtime 子目录

CLI build.rs SHALL 在编译前将 init-repo 复制到 `target/init-repo-staging/`，同时将 `packages/sdk-core`、`packages/sdk-react`、`packages/sdk-agent` 复制到 staging 内的 `runtime/sdk/{core,react,agent}/`（排除 `node_modules`、`dist`）。`include_dir!` SHALL 指向此 staging 目录，最终二进制内嵌完整 runtime 子树。

#### Scenario: staging 包含 runtime/sdk
- **WHEN** 执行 `cargo build`
- **THEN** `target/init-repo-staging/runtime/sdk/core/`、`react/`、`agent/` 各自包含对应 SDK 包的源码（不含 node_modules）

#### Scenario: 编译产物内嵌 runtime
- **WHEN** 编译完成后检查二进制内嵌资源
- **THEN** 内嵌模板包含 `runtime/version.json`、`runtime/vite-plugin.ts`、`runtime/dev-shell.tsx`、`runtime/sdk/core/package.json` 等

### Requirement: 内置模板包含 runtime/version.json

`init-repo/runtime/version.json` SHALL 在编译期由 build.rs 动态生成，内容为 `{"cliVersion": "<cargo_pkg_version>"}`。此文件在 init-repo 源码目录中**不存在**（避免手动维护），仅出现在 staging 和用户项目内。

#### Scenario: 源码目录无 version.json
- **WHEN** 查看 `init-repo/runtime/` 源码目录
- **THEN** 目录中不存在 `version.json`（由 build.rs 在 staging 时生成）

#### Scenario: staging 生成 version.json
- **WHEN** 执行 `cargo build`
- **THEN** `target/init-repo-staging/runtime/version.json` 存在，内容为 `{"cliVersion": "0.5.0"}`（以当前版本为例）

### Requirement: 内置模板 skills 采用目录形态

CLI 内嵌模板的 `.claude/skills/` SHALL 采用「一 skill 一目录」形态：每个 skill 是 `localapp-<name>/SKILL.md` 目录，而非扁平的 `localapp-<name>.md` 文件。此形态便于 sync 按 prefix 原子覆盖。

#### Scenario: 内嵌 skills 全部为目录形态
- **WHEN** 检查内嵌模板的 `.claude/skills/`
- **THEN** 所有 localapp skill 都是子目录（如 `localapp/SKILL.md`、`localapp-ui/SKILL.md`、`localapp-notify/SKILL.md` 等），不存在扁平的 `localapp-*.md` 文件

#### Scenario: init 后用户项目 skills 形态一致
- **WHEN** 执行 `localapp init my-app`
- **THEN** `my-app/.claude/skills/` 下 localapp 相关 skills 全部为目录形态

### Requirement: 内置模板生成 native 兼容项目
CLI 内置 init-repo 模板 SHALL 默认生成 native runtime 兼容项目。模板 SHALL 使用 SDK 平台能力入口，不依赖 iframe 或 sandbox。

#### Scenario: localapp init 生成 native 模板
- **WHEN** 用户执行 `localapp init`
- **THEN** 生成项目 SHALL 包含 native runtime 的 `.localapp/runtime`
- **AND** 示例代码 SHALL 通过 SDK 调用平台能力

### Requirement: 内置模板文档说明 native 约束
内置模板 SHALL 在开发指南中说明应用运行在平台 shell 的 app container 内，平台 nav-shell、认证入口和平台能力由平台拥有。

#### Scenario: 文档不再指导 iframe 适配
- **WHEN** 用户阅读模板 skills 或开发文档
- **THEN** 文档 SHALL NOT 要求开发者处理 iframe sandbox 限制
- **AND** 文档 SHALL 指导使用 `platform-runtime`

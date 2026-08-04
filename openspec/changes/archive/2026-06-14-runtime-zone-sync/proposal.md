## Why

当前 `localapp init` 把 init-repo/ 的 96 个文件一次性复制到用户项目，复制后**所有文件归用户所有**，CLI 完全失去对它们的控制。后续 SDK 修了 bug、DevShell 改了交互、skills 文档加了新内容（如最近新增的 `localapp-notify.md`），**已存在的用户项目永远拿不到**——除非用户手动 diff + 复制粘贴。

由于项目暂无 npm 仓库（无法把 SDK / DevShell / skills 发到 npm 让用户 `npm install` 升级），必须由 CLI 二进制本身担任"包管理器"角色：它已经 self-update、已经 `include_dir!` 烧进了 init-repo，缺的只是一套干净的"哪些文件归 CLI 管"边界 + 一个把这些领地刷新到最新版的命令。

由于系统当前未公开发布、无存量用户，重构的迁移成本基本为零，是建立"一劳永逸"更新通道的最佳时机。

## What Changes

- **引入"原子领地"概念**：CLI 拥有几个明确的目录/目录前缀，整个领地由 CLI 管理、sync 时整体覆盖（无 hash 追踪、无三方合并）
- **新增 `.localapp/runtime/` 领地**：所有"我们的"代码集中到此处，包括：
  - 现 `vendor/sdk-core` / `sdk-react` / `sdk-agent` → 移至 `.localapp/runtime/sdk/{core,react,agent}/`
  - 现 `src/dev-shell.tsx`（569 行）→ 移至 `.localapp/runtime/dev-shell.tsx`
  - 现 `vite.config.ts` 的 proxy 逻辑 → 提取为 `.localapp/runtime/vite-plugin.ts`
  - 现 `src/lib/utils.ts`、`src/hooks/use-mobile.ts`、`src/index.css` 预设等 → 移至 `.localapp/runtime/`
  - 新增 `.localapp/runtime/version.json`（CLI 版本号，供 sync 比对）
- **重组 skills 为独立目录领地**：现 `.claude/skills/localapp-*.md`（扁平文件）→ 改为 `.claude/skills/localapp-*/SKILL.md`（一 skill 一目录），便于按 prefix 原子覆盖；`agent-tool-patterns/` 同样视为 CLI 领地
- **新增 `localapp sync` 命令**：删除所有 CLI 领地后从 CLI 二进制重新抽出。算法极简：`rm -rf` CLI 拥有的目录 → 解压最新版
- **新增 postinstall 自动 sync**：用户 `package.json` 中加 `"postinstall": "localapp sync --quiet"`，clone + `npm install` 后 runtime 自动就位
- **新增 `localapp sync --interactive` 模式**：显式跑、显示 diff（CLI 版本 vs runtime 版本、列出变更），适合升级前确认
- **新增 `localapp sync --off` 开关**：在 `.localapp/dev-config.json` 写入 `autoSync: false`，关闭 postinstall 自动 sync（高级用户用）
- **新增 `localapp eject` 命令**：把 `.localapp/runtime/` 和 `.claude/skills/localapp-*/` 整体移出 CLI 领地（重命名/移动到用户目录），用户从此脱离自动更新。一次性、不可逆、明确告知"你失去了更新通道"
- **BREAKING**：`init-repo/` 的源码结构重组——`vendor/`、`src/dev-shell.tsx`、`src/lib/utils.ts`、`src/hooks/use-mobile.ts`、`src/index.css` 等迁移到新的 `runtime/` 子目录；用户 `package.json` 改为 `file:./.localapp/runtime/sdk/core` 等
- **BREAKING**：用户项目根目录的 `vite.config.ts` 缩为 3 行（仅调用从 runtime 来的 plugin）；`tsconfig.json` 改为 `extends .localapp/runtime/tsconfig.base.json`

## Capabilities

### New Capabilities

- `runtime-zone-sync`: CLI 拥有的"原子领地"边界定义、`localapp sync` 命令、postinstall 自动同步、`--interactive` 显式模式、`--off` 关闭开关、`localapp eject` 脱钩命令

### Modified Capabilities

- `cli-builtin-template`: SDK vendor 路径从 `vendor/sdk-*` 改为 `.localapp/runtime/sdk/*`；package.json 中 `workspace:*` 替换目标改为 `file:./.localapp/runtime/sdk/*`；CLI 领地的文件（DevShell、vite-plugin、tsconfig.base、styles 预设等）作为独立子集抽取到 `.localapp/runtime/`
- `init-template`: init-repo/ 源码结构重组——抽出 `runtime/` 子目录承载所有 CLI 拥有的代码；用户项目根的 vite.config.ts、tsconfig.json、main.tsx 缩为极简引用层；skills 重组为 `localapp-<name>/SKILL.md` 目录形式
- `project-init`: `localapp init` 不仅要抽出用户项目文件，还要抽出 CLI 领地（runtime/ + skills/）；初始化时写入 `.localapp/runtime/version.json`；在用户 `package.json` 注入 `postinstall` 钩子
- `cli-tool`: 新增 `sync` 和 `eject` 两个子命令；sync 子命令支持 `--quiet`、`--interactive`、`--off` 参数

## Impact

**受影响代码**：

- `packages/cli/`：
  - `src/template.rs` — 重组模板抽取逻辑，区分"用户领地"与"CLI 领地"两套抽取函数
  - `src/commands/init.rs` — 改写 init 流程，注入 postinstall 钩子、写 version.json
  - 新增 `src/commands/sync.rs` — 实现 sync 命令（含 --quiet/--interactive/--off）
  - 新增 `src/commands/eject.rs` — 实现 eject 命令
  - `src/main.rs`、`src/commands/mod.rs` — 注册新子命令
- `init-repo/`：
  - 新增 `runtime/` 子目录，承载 vite-plugin、dev-shell、tsconfig.base、styles、sdk/ 等
  - 根目录的 vite.config.ts、tsconfig.json、src/main.tsx 缩为极简引用层
  - `.claude/skills/` 下扁平文件改为 `localapp-*/SKILL.md` 目录形式
  - 删除 `src/dev-shell.tsx`、`src/lib/utils.ts`、`src/hooks/use-mobile.ts`、`src/index.css`（迁入 runtime/）
- `packages/server/`：无影响（sync 不涉及 server）
- `packages/web/`：无影响
- 测试：`init-repo/tests/` 中依赖 dev-shell 路径的测试需要更新 import；CLI 侧新增 sync/eject 命令的单测与 e2e

**受影响 API/依赖**：无 server API 变化；用户项目 `package.json` 结构有 BREAKING 变更（`file:` 路径改变），但因系统未发布，无实际破坏。

**部署影响**：用户 clone 项目后执行 `npm install`，postinstall 钩子自动 sync runtime，无需额外操作；离线场景下首次 `localapp init` 即抽出 runtime，后续 `localapp sync` 离线可用（不依赖 server）。

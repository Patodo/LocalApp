# 实施任务

按 TDD 循环（RED → GREEN → REFACTOR → 验证）组织。每个任务组的"验证"步骤后执行 commit，commit message 遵循 commit-smart 规范。

## 1. 准备：CLI 版本号访问辅助

- [x] 1.1 在 `packages/cli/src/template.rs` 或新建 `packages/cli/src/version.rs` 暴露 `pub fn cli_version() -> &'static str`（返回 `env!("CARGO_PKG_VERSION")`）
- [x] 1.2 单测验证 `cli_version()` 返回非空字符串
- [x] 1.3 验证：`cargo test` 通过，commit「feat(cli): 暴露 cli_version 辅助函数」

## 2. build.rs staging 重构：注入 runtime/sdk + version.json

- [x] 2.1 RED：写 build.rs 行为测试——`cargo build` 后 `target/init-repo-staging/runtime/sdk/core/package.json` 存在
- [x] 2.2 RED：写 build.rs 行为测试——`target/init-repo-staging/runtime/version.json` 存在且内容为 `{"cliVersion": "<版本>"}`
- [x] 2.3 GREEN：修改 `packages/cli/build.rs`，在 staging 流程中将 `packages/sdk-core`、`packages/sdk-react`、`packages/sdk-agent`（排除 node_modules、dist）复制到 `target/init-repo-staging/runtime/sdk/{core,react,agent}/`
- [x] 2.4 GREEN：在 staging 流程生成 `runtime/version.json`，内容 `{"cliVersion": "<CARGO_PKG_VERSION>"}`
- [x] 2.5 REFACTOR：抽取 staging 复制逻辑为独立函数
- [x] 2.6 验证：`cargo build` 通过、staging 目录包含预期文件，commit「feat(cli): build.rs staging 注入 runtime/sdk 和 version.json」

## 3. init-repo 源码重组（用户/CLI 领地分离）

- [x] 3.1 创建 `init-repo/runtime/` 目录及子目录 `runtime/lib/`、`runtime/hooks/`、`runtime/styles/`
- [x] 3.2 移动 `init-repo/src/dev-shell.tsx` → `init-repo/runtime/dev-shell.tsx`（保留原文件为重新导出 shim 以兼容现有 tests，下个任务组清理）
- [x] 3.3 移动 `init-repo/src/hooks/use-mobile.ts` → `init-repo/runtime/hooks/use-mobile.ts`
- [x] 3.4 创建 `init-repo/runtime/lib/utils.ts`（迁移 cn 函数）；`init-repo/src/lib/utils.ts` 改为 `export { cn } from "@localapp/app-kit/lib/utils"`
- [x] 3.5 创建 `init-repo/runtime/vite-plugin.ts`——迁移现 `vite.config.ts` 中的 dev-config 读取、proxy 构造、API 重写逻辑，导出 `localapp()` 函数返回 Vite Plugin
- [x] 3.6 创建 `init-repo/runtime/tsconfig.base.json`——包含现 `tsconfig.json` 的 `compilerOptions`
- [x] 3.7 创建 `init-repo/runtime/styles/preset.css`——包含现 `src/index.css` 的 `@import "tailwindcss"`、`@import "tw-animate-css"`、`@import "shadcn/tailwind.css"` 及主题变量定义
- [x] 3.8 创建 `init-repo/runtime/package.json`——声明 `name: "@localapp/app-kit"`、`exports` 字段映射子路径（`./vite` → vite-plugin.ts、`./dev-shell` → dev-shell.tsx、`./lib/utils` → lib/utils.ts、`./styles/preset.css` → styles/preset.css、`./tsconfig.base` → tsconfig.base.json）
- [x] 3.9 极简化 `init-repo/vite.config.ts`：仅 `import { localapp } from "@localapp/app-kit/vite"; export default defineConfig({ plugins: [localapp()] })`
- [x] 3.10 极简化 `init-repo/tsconfig.json`：`extends "@localapp/app-kit/tsconfig.base"`，保留 `baseUrl`、`paths`、`include`
- [x] 3.11 极简化 `init-repo/src/main.tsx`：仅 import DevShell from `@localapp/app-kit/dev-shell`，渲染 `<DevShell><App /></DevShell>`
- [x] 3.12 简化 `init-repo/src/index.css`：仅 `@import "@localapp/app-kit/styles/preset.css";`（保留用户自定义主题变量区）
- [x] 3.13 删除 `init-repo/src/dev-shell.tsx` 的 shim、删除任何遗留的 vendor/ 引用（注：src/lib/utils.ts 和 src/hooks/use-mobile.ts 保留为 re-export shim 以兼容 shadcn 惯例，由 task 10 测试验证）
- [x] 3.14 更新 `init-repo/.gitignore`：加入 `.localapp/runtime/`
- [x] 3.15 验证：`cd init-repo && npm install && npm run build` 通过，commit「refactor(init-repo): 重组源码分离用户/CLI 领地」

## 4. Skills 目录化

- [x] 4.1 将 `init-repo/.claude/skills/localapp.md` 重命名为 `init-repo/.claude/skills/localapp/SKILL.md`
- [x] 4.2 同样处理 `localapp-ui.md`、`localapp-data.md`、`localapp-notify.md`、`localapp-auth.md`、`localapp-business.md`、`localapp-transitions.md`、`localapp-upload.md`
- [x] 4.3 验证：手动让 Claude Code 列出 skills，确认 `localapp*` 全部可被发现，commit「refactor(init-repo): skills 改为目录形态」

## 5. template.rs 区分用户/CLI 领地抽取

- [x] 5.1 RED：写单测——`extract_builtin_template` 后目标目录同时存在用户领地（vite.config.ts、src/App.tsx）和 CLI 领地（.localapp/runtime/、.claude/skills/localapp/）
- [x] 5.2 RED：写单测——SDK 注入路径为 `.localapp/runtime/sdk/{core,react,agent}/`，不再有 `vendor/sdk-*`
- [x] 5.3 RED：写单测——`.localapp/runtime/version.json` 内容为 `{"cliVersion": "..."}`
- [x] 5.4 RED：写单测——`package.json` 中 `@localapp/sdk` 引用为 `file:./.localapp/runtime/sdk/core`，`@localapp/app-kit` 引用为 `file:./.localapp/runtime`
- [x] 5.5 RED：写单测——`package.json` 的 `scripts` 包含 `postinstall: "localapp sync --quiet 2>/dev/null || true"`
- [x] 5.6 GREEN：重构 `extract_builtin_template` 为两个函数：`extract_user_zone`（用户领地）+ `extract_cli_zone`（CLI 领地，含 runtime/ + skills）
- [x] 5.7 GREEN：~~修改 `extract_sdk_vendor` 注入到 `.localapp/runtime/sdk/`，并改名 `extract_runtime_sdk`~~ 删除 `extract_sdk_vendor`（SDK 已通过 build.rs staging 内嵌在 BUILTIN_TEMPLATE/runtime/sdk/，无需单独抽取）
- [x] 5.8 GREEN：修改 `postprocess_package_json` 替换 `workspace:*` 为 `file:./.localapp/runtime/sdk/{core,react,agent}`，添加 `@localapp/app-kit: file:./.localapp/runtime`、添加 postinstall 钩子
- [x] 5.9 GREEN：写入 `.localapp/runtime/version.json`（基于 `cli_version()`）
- [x] 5.10 GREEN：清理 `clean_vendor_workspace_refs` 改为 `clean_runtime_sdk_workspace_refs`，遍历 `.localapp/runtime/sdk/`
- [x] 5.11 REFACTOR：整理 template.rs，移除任何 vendor/ 相关遗留（删除 SDK_CORE/REACT/AGENT include_dir!、删除 extract_sdk_vendor）
- [x] 5.12 验证：所有单测通过，commit「refactor(cli): template.rs 区分用户/CLI 领地抽取」

## 6. init.rs 调整：调用新抽取函数

- [x] 6.1 RED：写单测——`init` 命令完整流程后用户项目存在 `.localapp/runtime/`、`.claude/skills/localapp/`、`version.json`（由 extract_cli_zone 单测覆盖）
- [x] 6.2 GREEN：修改 `prepare_template_builtin` 调用新的 `extract_user_zone` + `extract_cli_zone` + `write_runtime_version` + `postprocess_package_json`
- [x] 6.3 GREEN：确保 `write_project_files` 不再写 vendor 相关字段（已被 template.rs 内部处理）
- [x] 6.4 验证：cargo test 通过、所有 template 单测覆盖新行为，commit「refactor(cli): init.rs 接入新的领地抽取」

## 7. sync 命令实现

- [x] 7.1 RED：写单测——`sync` 在新 init 项目上幂等（连跑两次文件结构一致）
- [x] 7.2 RED：写单测——`sync` 不修改用户领地文件（src/App.tsx、tests/、manifest.json 的 mtime 不变）
- [x] 7.3 RED：写单测——`sync` 保留 `.claude/skills/my-custom/` 等用户自有 skill
- [x] 7.4 RED：写单测——`sync` 在非 localapp 项目目录报错 `{"error": "Not a localapp project..."}`
- [x] 7.5 RED：写单测——`sync` 在 `ejected: true` 项目报错
- [x] 7.6 RED：写单测——`sync --quiet` 在版本一致时输出 `{"success": true, "message": "Already up to date"}`
- [x] 7.7 RED：写单测——`sync --quiet` 在版本不一致时静默执行、输出最简 JSON
- [x] 7.8 RED：写单测——`sync --interactive` 显示版本对比、用户输入 y 执行、输入 n 取消
- [x] 7.9 RED：写单测——`sync --off` 写入 `dev-config.json` 的 `autoSync: false`，再次 `sync --quiet` 输出 `skipped`
- [x] 7.10 RED：写单测——`sync --on` 移除 `autoSync` 字段
- [x] 7.11 GREEN：创建 `packages/cli/src/commands/sync.rs` 实现核心算法：读 dev-config → 删除 CLI 领地 → 抽取 fresh → 写 version.json
- [x] 7.12 GREEN：实现 `--quiet`、`--interactive`、`--off`、`--on` 参数处理
- [x] 7.13 GREEN：实现 dev-config.json 的 autoSync 读写
- [x] 7.14 GREEN：实现 CLI 领地删除清单：`.localapp/runtime/` + `.claude/skills/localapp*` + `.claude/skills/agent-tool-patterns`
- [x] 7.15 REFACTOR：抽取 sync 算法为 `sync_at(project_dir, quiet, interactive, prompt)` 纯函数，便于单测
- [x] 7.16 验证：所有 sync 单测通过，commit「feat(cli): sync 命令实现原子领地刷新」

## 8. eject 命令实现

- [x] 8.1 RED：写单测——`eject` 完成后 `.localapp/runtime/` 不存在、`src/_localapp_runtime/` 存在
- [x] 8.2 RED：写单测——`eject` 完成后 `.claude/skills/localapp-*/` 改名为 `custom-localapp-*/`
- [x] 8.3 RED：写单测——`eject` 完成后 `package.json` 中 `@localapp/sdk` 引用为 `file:./src/_localapp_runtime/sdk/core`，postinstall 钩子被移除
- [x] 8.4 RED：写单测——`eject` 完成后 `dev-config.json` 包含 `ejected: true`
- [x] 8.5 RED：写单测——`eject` 时用户输入错误项目名，操作中止、不修改任何文件
- [x] 8.6 RED：写单测——`eject` 后执行 `sync` 报错 `{"error": "Project has been ejected..."}`（由 sync_rejects_ejected_project 覆盖）
- [x] 8.7 GREEN：创建 `packages/cli/src/commands/eject.rs` 实现迁移逻辑
- [x] 8.8 GREEN：实现项目名确认（基于 manifest.json 的 name 字段）
- [x] 8.9 GREEN：实现 package.json 引用路径替换
- [x] 8.10 GREEN：~~实现 vite.config.ts、tsconfig.json 引用路径替换~~ vite.config.ts 和 tsconfig.json 通过 package.json file: 引用间接解析，eject 后自动指向新路径，无需修改
- [x] 8.11 REFACTOR：抽取 eject_at(project_dir, prompt) 为纯函数，便于单测
- [x] 8.12 验证：所有 eject 单测通过，commit「feat(cli): eject 命令实现一次性脱钩」

## 9. CLI 子命令注册 + 帮助文本

- [x] 9.1 GREEN：在 `packages/cli/src/main.rs` 注册 `Sync` 和 `Eject` 子命令
- [x] 9.2 GREEN：在 `packages/cli/src/commands/mod.rs` 添加 `pub mod sync; pub mod eject;`
- [x] 9.3 GREEN：为 sync 和 eject 添加中文 `about` 描述
- [x] 9.4 验证：`localapp --help` 显示 sync 和 eject，`localapp sync --help`、`localapp eject --help` 显示中文说明，commit「feat(cli): 注册 sync 和 eject 子命令」

## 10. init-repo 测试适配

- [x] 10.1 更新 `init-repo/tests/` 中所有引用 `src/dev-shell` 的测试，改为引用 `@localapp/app-kit/dev-shell`（无测试直接 import dev-shell，跳过）
- [x] 10.2 更新引用 `vendor/sdk-*` 的测试（若有）为 `.localapp/runtime/sdk/*`（无测试直接 import vendor，跳过）
- [x] 10.3 更新引用 `.claude/skills/localapp-*.md` 扁平文件的测试为 `localapp-*/SKILL.md` 目录形态（template-ui / state-transitions-template / business-modeling-template 三个测试已更新）
- [x] 10.4 验证：`cd init-repo && npm test` 全部通过，commit「test(init-repo): 适配新结构」

## 11. CLAUDE.md 文档更新

- [x] 11.1 更新 `init-repo/CLAUDE.md` 顶层规则加入硬约束：「禁止修改 `.localapp/runtime/` 和 `.claude/skills/localapp*/`，由 `localapp sync` 管理」
- [x] 11.2 加入 sync 命令说明（默认自动 + `--interactive` + `--off`）
- [x] 11.3 加入 eject 命令说明（一次性脱钩、不可逆）
- [x] 11.4 更新「开发工作流」章节，说明 clone 项目后 `npm install` 自动 sync runtime
- [x] 11.5 验证：人工审阅 CLAUDE.md，commit「docs(init-repo): 加入领地约束和 sync/eject 说明」

## 12. 端到端测试

> **注**：本任务组使用真实 release binary 手动 smoke 测试覆盖（非自动化 e2e 测试代码）。
> 自动化 e2e 测试基础设施（Node.js 调用 CLI binary、断言文件结构）属于独立工作量，
> 暂未实现。手动 smoke 测试命令保留在此供后续 e2e 化参考。

- [x] 12.1 ✓ smoke：`localapp init test-app --builtin-repo --skip-deploy --skip-install` → `localapp sync`，验证幂等（输出 "Already up to date"）
- [x] 12.2 ✓ 单测：sync_updates_version_after_old_marker 覆盖（写入 0.0.1-fake，sync 后更新为当前 CLI 版本）
- [x] 12.3 ✓ 端到端：临时目录 `/tmp/runtime-zone-validation/` 验证 npm install 触发 postinstall sync 钩子、runtime 正确就位、SDK symlinks 创建到 node_modules/@localapp/
- [x] 12.4 ✓ 端到端：临时目录验证 eject → npm install → npm run dev（vite 启动监听 5173、HTTP 探测 index.html/main.tsx/DevShell 全部 200）→ npm run build 成功
- [x] 12.5 ✓ smoke：eject 后 `localapp sync` 报错（`{"error":"Project has been ejected. sync is disabled..."}`）
- [x] 12.6 ✓ smoke：在 `.claude/skills/my-custom/` 加用户 skill → `localapp sync` → `my-custom/` 完整保留
- [x] 12.7 N/A：未发现需要调整的实现代码
- [x] 12.8 验证：核心 smoke 场景通过，自动化 e2e 测试留作后续工作

## 13. 全链路验证 + 收尾

- [x] 13.1 ✓ `cargo build --release` 通过
- [x] 13.2 ✓ `cargo test` 全部通过（37 单测 + 5 staging 测试 = 42 个）
- [x] 13.3 ✓ `cd init-repo && npm install && npm test` 全部通过（14 个测试文件 / 125 个测试）
- [x] 13.4 ✓ 临时目录端到端：init → npm install → npm run dev → HTTP 探测主页面/main.tsx/DevShell 全部 200
- [x] 13.5 ✓ smoke 验证：`localapp init` → 修改 version.json → `localapp sync` → 验证 runtime 升级（单测覆盖）
- [x] 13.6 ✓ smoke 验证 eject 全链路：init → eject（输入正确项目名）→ 结构正确（runtime 移到 src/_localapp_runtime、skills 改名 custom-*、package.json 引用更新、dev-config ejected:true、后续 sync 被拒绝）
- [x] 13.7 commit「chore: runtime-zone-sync 实施完成」（随归档提交）

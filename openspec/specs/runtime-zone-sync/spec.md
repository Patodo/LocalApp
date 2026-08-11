## Purpose

This spec describes the runtime zone sync capability in LocalApp. CLI SHALL define explicit "CLI zones" in user projects and provide `sync`/`eject` subcommands to keep these zones aligned with the CLI binary version, or to permanently detach them into user territory.
## Requirements
### Requirement: CLI 拥有的"原子领地"边界定义

CLI SHALL 拥有以下目录（**整个目录**归 CLI 管理，sync 时整体覆盖、用户不得手动修改）：

- `.localapp/runtime/` — 所有"我们的"代码（SDK、DevShell、vite-plugin、tsconfig.base、styles 预设等）
- `.claude/skills/localapp*/` — 任何以 `localapp` 开头的 skill 目录
- `.claude/skills/agent-tool-patterns/` — 单独白名单（历史命名）

判定规则：
- `.claude/skills/` 下子目录名匹配 `localapp*` 或等于 `agent-tool-patterns` 的，整目录归 CLI
- `.localapp/runtime/` 整目录归 CLI
- 其他文件和目录归用户

CLI init SHALL 在用户项目根的 `CLAUDE.md` 写入硬约束：「禁止修改 `.localapp/runtime/` 和 `.claude/skills/localapp*/`，这些目录由 `localapp sync` 管理，会被覆盖。」

#### Scenario: 用户项目内的 CLI 领地清单
- **WHEN** `localapp init` 完成后检查用户项目
- **THEN** 项目内存在 `.localapp/runtime/`，包含 SDK、DevShell、vite-plugin 等；存在 `.claude/skills/localapp/SKILL.md` 等以 `localapp` 开头的 skill 目录

#### Scenario: CLAUDE.md 包含领地禁令
- **WHEN** 查看用户项目根的 `CLAUDE.md`
- **THEN** 文档明确列出 CLI 领地的路径，并说明这些目录由 `localapp sync` 管理、禁止手动修改

#### Scenario: 用户自有 skill 与 CLI 领地共存
- **WHEN** 用户在 `.claude/skills/my-custom-skill/SKILL.md` 创建自定义 skill
- **THEN** sync 命令不会删除或修改该目录，因为目录名不以 `localapp` 开头、也不等于 `agent-tool-patterns`

### Requirement: localapp sync 命令——原子覆盖 CLI 领地

CLI SHALL 提供 `localapp sync` 子命令，将 CLI 二进制内嵌的最新模板刷新到当前用户项目的 CLI 领地。算法 SHALL 为：

1. 校验当前目录是 localapp 项目（存在 `.localapp/dev-config.json`）
2. 从 `.localapp/project-config.json` 校验项目未被 eject；若发现旧 `.localapp/dev-config.json` 中的 `autoSync`/`ejected` 标记，先以“持久配置原子写入、临时配置原子清理”的顺序完成可重复迁移
3. 删除 CLI 领地：`rm -rf .localapp/runtime/`、遍历 `.claude/skills/` 删除 `localapp*` 和 `agent-tool-patterns` 子目录
4. 从 CLI 二进制 `include_dir!` 重新抽出 runtime 和 skills
5. 写入新的 `.localapp/runtime/version.json`（包含 `cliVersion` 字段）
6. 提示用户运行 `npm install` 刷新依赖（或在 `--quiet` 模式下自动调用）

sync SHALL 幂等：连续执行两次结果完全一致。sync SHALL NOT 触碰用户领地的任何文件。

#### Scenario: 首次 sync 在新 init 的项目上
- **WHEN** 执行 `localapp init my-app` 后立即执行 `localapp sync`（在 my-app 目录内）
- **THEN** runtime 和 skills 被刷新到当前 CLI 版本，文件结构不变（幂等），输出 `{"success": true, "version": "<cli_version>"}`

#### Scenario: CLI 升级后 sync 更新 runtime
- **WHEN** 项目 `.localapp/runtime/version.json` 显示 `cliVersion: 0.4.0`，CLI 二进制版本为 0.5.0，执行 `localapp sync`
- **THEN** runtime 被覆盖为 0.5.0 的内容，version.json 更新为 `cliVersion: 0.5.0`，输出 `{"success": true, "version": "0.5.0", "previousVersion": "0.4.0"}`

#### Scenario: sync 在非项目目录执行
- **WHEN** 当前目录不存在 `.localapp/dev-config.json`，执行 `localapp sync`
- **THEN** 输出错误 `{"error": "Not a localapp project. Run 'localapp init' first."}`，退出码 1

#### Scenario: sync 在已 eject 的项目执行
- **WHEN** `.localapp/project-config.json` 包含 `ejected: true`，执行 `localapp sync`
- **THEN** 输出错误 `{"error": "Project has been ejected. sync is permanently disabled for this project."}`，退出码 1

#### Scenario: 迁移旧持久标记
- **WHEN** 旧 `.localapp/dev-config.json` 包含 `autoSync` 或 `ejected`
- **THEN** CLI SHALL 先原子写入 `.localapp/project-config.json`
- **AND** 再原子移除 `dev-config.json` 中这两个字段，保留其临时运行字段
- **AND** 任一步中断后再次执行 SHALL 幂等完成迁移且不得丢失已关闭同步或已 eject 状态

#### Scenario: sync 保留用户自有 skill
- **WHEN** `.claude/skills/my-custom-skill/` 存在，执行 `localapp sync`
- **THEN** `my-custom-skill/` 目录完整保留，不被删除

#### Scenario: sync 不触碰用户代码
- **WHEN** 项目内存在 `src/App.tsx`、`tests/my-test.test.ts`、`manifest.json` 等用户文件，执行 `localapp sync`
- **THEN** 这些文件的 mtime 和内容完全不变

### Requirement: localapp sync --quiet 静默模式

CLI SHALL 支持 `localapp sync --quiet` 参数。在 quiet 模式下：
- 若当前版本与 CLI 版本一致，输出仅一行 `{"success": true, "message": "Already up to date"}`
- 若版本不一致，正常执行 sync 但不打印进度信息
- 任何错误（非项目目录、已 eject 等）SHALL 退出码 0 且不输出错误到 stderr（仅 debug 模式输出）

`--quiet` 设计用于 npm postinstall 钩子，避免阻断 `npm install`。

#### Scenario: postinstall 场景下版本一致
- **WHEN** 在 `npm install` 触发的 postinstall 钩子中执行 `localapp sync --quiet`，runtime 版本与 CLI 一致
- **THEN** 退出码 0，stdout 仅输出 `{"success": true, "message": "Already up to date"}`，stderr 无输出

#### Scenario: postinstall 场景下 CLI 不在 PATH
- **WHEN** npm postinstall 钩子尝试执行 `localapp sync --quiet`，但 `localapp` 不在 PATH（如 CI 环境）
- **THEN** 钩子脚本 SHALL 静默失败、退出码 0（包装为 `localapp sync --quiet 2>/dev/null || true`），不阻断 `npm install`

#### Scenario: quiet 模式下版本升级
- **WHEN** 执行 `localapp sync --quiet` 且 runtime 版本与 CLI 不一致
- **THEN** 静默执行 sync 流程，stdout 输出 `{"success": true, "version": "...", "previousVersion": "..."}`，无进度信息

### Requirement: localapp sync --interactive 显式模式

CLI SHALL 支持 `localapp sync --interactive` 参数。在 interactive 模式下：
- 显示当前 runtime 版本 vs CLI 版本的对比
- 列出 CLI 领地的删除清单和新增清单
- 询问用户确认（`y/n`）后才执行
- 拒绝则放弃，输出 `{"success": false, "cancelled": true}`

#### Scenario: interactive 模式询问确认
- **WHEN** 执行 `localapp sync --interactive`，runtime 版本 0.4.0、CLI 版本 0.5.0
- **THEN** 输出对比信息（`Current: 0.4.0 → Target: 0.5.0`、变更文件数等），提示用户输入 `y/n`

#### Scenario: 用户确认升级
- **WHEN** interactive 模式下用户输入 `y`
- **THEN** 执行 sync 流程，输出最终结果

#### Scenario: 用户拒绝升级
- **WHEN** interactive 模式下用户输入 `n`
- **THEN** 不修改任何文件，输出 `{"success": false, "cancelled": true}`，退出码 0

### Requirement: localapp sync --off 关闭自动同步

CLI SHALL 支持 `localapp sync --off` 参数。执行后：
- 在 `.localapp/project-config.json` 写入 `"autoSync": false`
- 后续 `localapp sync --quiet`（即 postinstall 钩子）SHALL 检测此字段、跳过 sync、输出 `{"success": true, "skipped": "autoSync disabled"}`
- 显式 `localapp sync` 和 `localapp sync --interactive` 不受影响，仍可手动执行

提供 `localapp sync --on` 反向操作，移除 `autoSync` 字段或设为 `true`。

#### Scenario: 关闭自动同步
- **WHEN** 执行 `localapp sync --off`
- **THEN** `.localapp/project-config.json` 包含 `"autoSync": false`，输出 `{"success": true, "autoSync": false}`
- **AND** `.localapp/dev-config.json` SHALL NOT 包含 `autoSync`

#### Scenario: 关闭后 postinstall 跳过
- **WHEN** `autoSync: false` 时触发 `localapp sync --quiet`
- **THEN** 输出 `{"success": true, "skipped": "autoSync disabled"}`，不修改任何文件，退出码 0

#### Scenario: 关闭后显式 sync 仍可用
- **WHEN** `autoSync: false` 时执行 `localapp sync`
- **THEN** 正常执行 sync 流程（显式命令不受 autoSync 影响）

#### Scenario: 重新开启自动同步
- **WHEN** 执行 `localapp sync --on`
- **THEN** `.localapp/project-config.json` 的 `autoSync` 字段被移除，postinstall 钩子恢复工作

### Requirement: localapp eject 命令——一次性脱钩

CLI SHALL 提供 `localapp eject` 子命令，将 CLI 领地的所有内容移出 CLI 管辖、转入用户领地。执行后：

1. `.localapp/runtime/` 整体移动到 `src/_localapp_runtime/`
2. `.claude/skills/localapp*/` 和 `agent-tool-patterns/` 重命名为 `custom-` 前缀（保留在 `.claude/skills/` 下）
3. 用户 `package.json` 中 `@localapp/sdk`、`@localapp/sdk-react`、`@localapp/sdk-agent`、`@localapp/app-kit` 的 `file:` 引用路径改为指向 `src/_localapp_runtime/...`
4. 用户 `package.json` 移除 `postinstall` 钩子（不再自动 sync）
5. 用户 `tsconfig.json` 和 `vite.config.ts` 中对 runtime 的引用改为指向新位置
6. `.localapp/project-config.json` 写入 `"ejected": true` 永久标记
7. 提示用户「你已脱离自动更新轨道，runtime 改动需要自行维护」

eject SHALL 不可逆——不提供 uneject 命令。eject SHALL 在执行前要求用户输入项目名确认（避免误操作）。

#### Scenario: eject 完整流程
- **WHEN** 执行 `localapp eject`，用户输入项目名确认
- **THEN** `.localapp/runtime/` 不再存在、`src/_localapp_runtime/` 出现且内容完整；`.claude/skills/localapp-*/` 全部改名为 `custom-localapp-*/`；`package.json` 中 SDK 引用指向新路径；`project-config.json` 包含 `"ejected": true`
- **AND** 后续规范化重写 `.localapp/dev-config.json` 不得解除 eject 状态

#### Scenario: eject 后 sync 被拒绝
- **WHEN** eject 后执行 `localapp sync`
- **THEN** 输出错误 `{"error": "Project has been ejected..."}`，不修改任何文件

#### Scenario: eject 后 npm run dev 仍可工作
- **WHEN** eject 完成后执行 `npm install && npm run dev`
- **THEN** vite dev server 正常启动、应用功能不受影响（因为 SDK 引用被改为新路径）

#### Scenario: eject 用户名确认错误
- **WHEN** 执行 `localapp eject`，但用户输入的项目名与 manifest.json 中的 name 不一致
- **THEN** 输出错误 `{"error": "Project name mismatch. Eject cancelled."}`，退出码 1，不修改任何文件

### Requirement: .localapp/runtime/version.json 版本标记

CLI SHALL 在 `.localapp/runtime/version.json` 写入 CLI 二进制版本号，供 sync 比对。文件内容 SHALL 为 `{"cliVersion": "<version>"}` 单字段。

init 时 SHALL 写入当前 CLI 版本。sync 时 SHALL 更新为新版本。eject 时 SHALL 删除此文件（runtime 已不在原位）。

#### Scenario: init 后 version.json 存在
- **WHEN** 执行 `localapp init my-app`，CLI 版本 0.5.0
- **THEN** `my-app/.localapp/runtime/version.json` 内容为 `{"cliVersion": "0.5.0"}`

#### Scenario: sync 后版本更新
- **WHEN** CLI 版本 0.6.0 时执行 `localapp sync`
- **THEN** `version.json` 内容更新为 `{"cliVersion": "0.6.0"}`

#### Scenario: eject 后 version.json 不存在
- **WHEN** 执行 `localapp eject`
- **THEN** `.localapp/runtime/version.json` 不存在（整个 runtime 目录已被移走）

### Requirement: 用户项目 package.json 注入 postinstall 钩子

CLI init SHALL 在用户项目的 `package.json` 中注入 `"postinstall": "localapp sync --quiet 2>/dev/null || true"` 钩子。此钩子确保用户 clone 项目并 `npm install` 后，runtime 自动就位。

钩子脚本 SHALL 使用 `2>/dev/null || true` 包装，确保即使 CLI 不可用也不阻断 `npm install`。

#### Scenario: init 后 package.json 包含 postinstall
- **WHEN** 执行 `localapp init my-app`
- **THEN** `my-app/package.json` 的 `scripts` 字段包含 `"postinstall": "localapp sync --quiet 2>/dev/null || true"`

#### Scenario: clone 项目后自动 sync
- **WHEN** 用户 clone 一个 localapp 项目（无 `.localapp/runtime/` 因被 gitignore），运行 `npm install`
- **THEN** postinstall 钩子触发 `localapp sync --quiet`，runtime 被抽出，npm install 完成后项目可立即 `npm run dev`

### Requirement: sync 命令自动 patch 旧版 main.tsx

`localapp sync` 命令在刷新 CLI 领地前后，SHALL 检查用户项目根的 `src/main.tsx` 是否包含旧版 DevShell 引用模式，并自动迁移到新版（只 render App）。

判定与处理逻辑：

1. 读取 `src/main.tsx` 内容，normalize（统一换行符为 LF、trim 头尾空白）
2. 与"旧模板字面量"（CLI 内嵌的 commit `a0f72c3` 版本 main.tsx）比较
3. **严格匹配**：自动改写为新版 main.tsx（只 render App），打印 "main.tsx migrated: DevShell reference removed"
4. **不严格匹配但含 DevShell 关键字**（如 `@localapp/app-kit/dev-shell`、`<DevShell`）：仅打印警告 "main.tsx contains DevShell reference but is customized. Please manually update to: render(<App />)"
5. **不含 DevShell 引用**：跳过，不做任何动作

sync 自动 patch SHALL 仅在非 eject 模式下执行；eject 后用户自负其责。

#### Scenario: sync 自动改写标准旧版 main.tsx
- **WHEN** 项目 `src/main.tsx` 内容等于旧模板（含 `import { DevShell } from "@localapp/app-kit/dev-shell"` 和 `<DevShell><App /></DevShell>`）
- **AND** 执行 `localapp sync`
- **THEN** `src/main.tsx` 被改写为新版（只 `import App` 和 `render(<App />)`）
- **AND** 终端打印 "main.tsx migrated: DevShell reference removed"

#### Scenario: sync 不改写已自定义的 main.tsx
- **WHEN** 项目 `src/main.tsx` 内容包含 DevShell 引用但与旧模板不完全相同（用户已自定义）
- **AND** 执行 `localapp sync`
- **THEN** `src/main.tsx` 不被改写
- **AND** 终端打印警告 "main.tsx contains DevShell reference but is customized. Please manually update to: render(<App />)"
- **AND** sync 流程继续执行（不阻断）

#### Scenario: sync 跳过新版 main.tsx
- **WHEN** 项目 `src/main.tsx` 内容已经是新版（无 DevShell 引用）
- **AND** 执行 `localapp sync`
- **THEN** `src/main.tsx` 不被修改
- **AND** 终端不打印任何 main.tsx 相关信息

#### Scenario: eject 后 sync 不 patch main.tsx
- **WHEN** 项目已执行过 `localapp eject`（`project-config.json` 的 `ejected` 字段为 true）
- **AND** 执行 `localapp sync`
- **THEN** sync 拒绝执行（按现有 eject 拒绝逻辑），main.tsx 不被检查或修改

#### Scenario: sync 时 main.tsx 不存在
- **WHEN** 项目根的 `src/main.tsx` 不存在（异常情况）
- **AND** 执行 `localapp sync`
- **THEN** sync 不报错，跳过 main.tsx 检查
- **AND** 其他 sync 流程正常执行

### Requirement: sync 同步 native runtime
`localapp sync` SHALL 同步 Vite plugin、DevShell、SDK 源码、样式 preset 和 version.json。runtime SHALL NOT 包含应用 HTTP 服务；`localapp dev` 使用可发布的统一 Server 包。

#### Scenario: sync 后 runtime 为最新 native 版本
- **WHEN** 用户执行 `localapp sync`
- **THEN** `.localapp/runtime/` SHALL 包含 native DevShell 和 vite plugin
- **AND** `.localapp/runtime/version.json` SHALL 写入当前 CLI 版本

### Requirement: sync 移除旧 iframe runtime 假设
`localapp sync` SHALL NOT 在模板 runtime 中保留要求应用通过 iframe、`window.parent` 或 sandbox 运行的代码路径。

#### Scenario: runtime 不包含 iframe host
- **WHEN** sync 完成后扫描 `.localapp/runtime`
- **THEN** runtime SHALL NOT 包含默认 iframe wrapper 代码

## ADDED Requirements

### Requirement: sync 命令

CLI SHALL 提供 `sync` 子命令，刷新当前项目的 CLI 领地（`.localapp/runtime/` 和 `.claude/skills/localapp-*/` + `agent-tool-patterns/`）到当前 CLI 二进制版本。帮助文本 SHALL 使用中文描述命令用途。

`sync` SHALL 支持以下参数：
- 无参数：默认同步模式，显示进度信息
- `--quiet`：静默模式，用于 postinstall 钩子，版本一致时输出最简、错误不阻断
- `--interactive`：交互模式，显示版本对比和变更清单，询问用户确认
- `--off`：在 `.localapp/dev-config.json` 写入 `autoSync: false`，关闭 postinstall 自动 sync
- `--on`：移除 `autoSync` 字段或设为 true，恢复 postinstall 自动 sync

#### Scenario: 帮助文本为中文
- **WHEN** 执行 `localapp sync --help`
- **THEN** 显示中文命令描述，列出 `--quiet`、`--interactive`、`--off`、`--on` 参数说明

#### Scenario: 默认同步模式输出进度
- **WHEN** 执行 `localapp sync`，runtime 版本与 CLI 不一致
- **THEN** 通过 stderr 输出每步进度（"  ✓ Removing CLI zones..."、"  ✓ Extracting runtime..."、"  ✓ Extracting skills..."），通过 stdout 输出 `{"success": true, "version": "...", "previousVersion": "..."}`

#### Scenario: --quiet 静默
- **WHEN** 执行 `localapp sync --quiet`
- **THEN** 不输出进度信息，仅输出最终 JSON 结果到 stdout

#### Scenario: --interactive 询问确认
- **WHEN** 执行 `localapp sync --interactive`
- **THEN** 显示当前版本 vs 目标版本对比、变更文件数，提示 `y/n` 确认

#### Scenario: --off 写入配置
- **WHEN** 执行 `localapp sync --off`
- **THEN** `.localapp/dev-config.json` 写入 `"autoSync": false`，stdout 输出 `{"success": true, "autoSync": false}`

#### Scenario: --on 移除配置
- **WHEN** 执行 `localapp sync --on`
- **THEN** `.localapp/dev-config.json` 移除 `autoSync` 字段（或设为 true），stdout 输出 `{"success": true, "autoSync": true}`

### Requirement: eject 命令

CLI SHALL 提供 `eject` 子命令，将 CLI 领地（`.localapp/runtime/` + `.claude/skills/localapp-*/` + `agent-tool-patterns/`）整体移出 CLI 管辖、转入用户领地，永久脱离自动更新。帮助文本 SHALL 使用中文描述命令用途、明确告知「不可逆」。

`eject` SHALL 执行：
1. 显示警告说明 eject 不可逆、失去自动更新
2. 要求用户输入 manifest.json 中的 name 确认（防误操作）
3. 校验 name 匹配，否则中止
4. `.localapp/runtime/` 移动到 `src/_localapp_runtime/`
5. `.claude/skills/localapp*/` 和 `agent-tool-patterns/` 重命名为 `custom-` 前缀
6. 用户 `package.json` 中 `@localapp/*` 的 `file:` 引用路径改为 `./src/_localapp_runtime/...`
7. 用户 `package.json` 移除 `postinstall` 钩子
8. 用户 `vite.config.ts`、`tsconfig.json` 中对 runtime 的引用改为新路径
9. `.localapp/dev-config.json` 写入 `"ejected": true`
10. 提示用户重新 `npm install` 刷新引用

#### Scenario: 帮助文本为中文且警示不可逆
- **WHEN** 执行 `localapp eject --help`
- **THEN** 显示中文命令描述，明确说明此命令不可逆、执行后失去自动更新

#### Scenario: eject 前要求项目名确认
- **WHEN** 执行 `localapp eject`，manifest.json 中 name 为 `my-app`
- **THEN** CLI 提示 "Type 'my-app' to confirm eject:"，等待用户输入

#### Scenario: 用户输入正确 name 完成 eject
- **WHEN** eject 提示后用户输入正确的项目名 `my-app`
- **THEN** CLI 执行迁移步骤：`.localapp/runtime/` 移至 `src/_localapp_runtime/`；skills 重命名为 `custom-*`；package.json 引用更新；dev-config.json 写入 `"ejected": true`；输出 `{"success": true, "ejected": true}`

#### Scenario: 用户输入错误 name 中止
- **WHEN** eject 提示后用户输入错误（如 `my-app-typo`）
- **THEN** CLI 输出 `{"error": "Project name mismatch. Eject cancelled."}`，退出码 1，不修改任何文件

#### Scenario: eject 后 npm install 可正常完成
- **WHEN** eject 完成后执行 `npm install`
- **THEN** npm install 成功，`node_modules/@localapp/*` 通过 file: 引用指向 `src/_localapp_runtime/`

#### Scenario: eject 后 npm run dev 可正常启动
- **WHEN** eject 完成后执行 `npm install && npm run dev`
- **THEN** vite dev server 正常启动，应用功能不受影响（SDK 引用路径已更新）

#### Scenario: eject 后的 sync 被拒绝
- **WHEN** eject 后执行 `localapp sync`
- **THEN** CLI 输出 `{"error": "Project has been ejected. sync is disabled..."}`，退出码 1，不修改任何文件

### Requirement: 顶层 help 文本包含 sync 和 eject

CLI 顶层 `--help` 输出 SHALL 列出 `sync` 和 `eject` 子命令，并使用中文描述用途。

#### Scenario: 顶层 help 包含新命令
- **WHEN** 执行 `localapp --help`
- **THEN** 子命令列表包含 `sync`（描述："刷新 CLI 领地到当前 CLI 版本"）和 `eject`（描述："脱离自动更新，将 CLI 领地转为用户代码"）

### Requirement: sync 命令端到端验证

e2e 测试 SHALL 验证 `sync` 命令的完整行为。

#### Scenario: 首次 sync 在新 init 项目上幂等
- **WHEN** 执行 `localapp init test-app`，cd 进 test-app，执行 `localapp sync`
- **THEN** 退出码 0，输出 `{"success": true, "version": "...", "previousVersion": "..."}`，runtime 内容与 init 后一致

#### Scenario: 模拟 CLI 升级后 sync 更新 runtime
- **WHEN** 项目内 `.localapp/runtime/version.json` 显示旧版本（手动改为 `0.0.1`），执行 `localapp sync`
- **THEN** version.json 被更新为当前 CLI 版本，stdout 输出包含 `previousVersion: "0.0.1"`

#### Scenario: sync 保留用户代码
- **WHEN** 项目内 `src/App.tsx` 和 `tests/x.test.ts` 存在，执行 `localapp sync`
- **THEN** 这些文件的内容和 mtime 完全不变

#### Scenario: sync 保留用户自定义 skill
- **WHEN** 项目内 `.claude/skills/my-custom/` 存在，执行 `localapp sync`
- **THEN** `my-custom/` 目录完整保留

#### Scenario: --interactive 用户拒绝
- **WHEN** 执行 `localapp sync --interactive`，提示后输入 `n`
- **THEN** 输出 `{"success": false, "cancelled": true}`，退出码 0，不修改任何文件

#### Scenario: --off 关闭自动 sync
- **WHEN** 执行 `localapp sync --off`，再执行 `localapp sync --quiet`
- **THEN** 第二次输出 `{"success": true, "skipped": "autoSync disabled"}`，不修改任何文件

### Requirement: eject 命令端到端验证

e2e 测试 SHALL 验证 `eject` 命令的完整行为。

#### Scenario: eject 完整流程
- **WHEN** 执行 `localapp init test-app`，cd 进 test-app，执行 `localapp eject`，输入正确的项目名
- **THEN** `.localapp/runtime/` 不存在；`src/_localapp_runtime/` 存在且内容完整；`.claude/skills/localapp-*/` 改名为 `custom-localapp-*/`；`package.json` 中 `@localapp/sdk` 等引用指向 `./src/_localapp_runtime/sdk/...`；`dev-config.json` 包含 `"ejected": true`

#### Scenario: eject 后构建仍成功
- **WHEN** eject 完成后执行 `npm install && npm run build`
- **THEN** 构建成功，无 import 错误

#### Scenario: eject 后 sync 被拒绝
- **WHEN** eject 完成后执行 `localapp sync`
- **THEN** 输出错误 `{"error": "Project has been ejected..."}`，退出码 1

## ADDED Requirements

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
- **WHEN** 项目已执行过 `localapp eject`（`dev-config.json` 的 `ejected` 字段为 true）
- **AND** 执行 `localapp sync`
- **THEN** sync 拒绝执行（按现有 eject 拒绝逻辑），main.tsx 不被检查或修改

#### Scenario: sync 时 main.tsx 不存在
- **WHEN** 项目根的 `src/main.tsx` 不存在（异常情况）
- **AND** 执行 `localapp sync`
- **THEN** sync 不报错，跳过 main.tsx 检查
- **AND** 其他 sync 流程正常执行

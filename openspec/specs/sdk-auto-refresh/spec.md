## Purpose

定义 CLI 管理的 runtime、SDK 与 Agent skills 在显式同步和开发启动前的精确刷新行为。

## Requirements

### Requirement: localapp sync 精确刷新 CLI 领地

`localapp sync` SHALL 用当前 CLI 内嵌模板替换 `.localapp/runtime/`、`.claude/skills/localapp*/` 和白名单 Agent skill 目录，并保留应用源码、backend contract、测试和用户自定义 skill。删除源模板中已不存在的 CLI-owned 文件 SHALL 是同步的一部分。

#### Scenario: CLI 版本变化

- **WHEN** 项目 runtime marker 早于当前 CLI 版本
- **THEN** sync SHALL 刷新 runtime、SDK 和 skills
- **AND** SHALL 更新 `.localapp/runtime/version.json`

#### Scenario: 旧 runtime 文件已废弃

- **WHEN** 已安装的 `@localapp/app-kit` 仍含源模板已删除的文件
- **THEN** 精确同步 SHALL 从目标依赖中移除该文件
- **AND** SHALL NOT保留可启动第二 HTTP 服务的残留入口

### Requirement: localapp dev 总是校验 CLI-owned runtime

除非 `.localapp/project-config.json` 已显式关闭 `autoSync` 或标记 `ejected`，`localapp dev` SHALL 在启动 Server 或 Vite 前刷新 CLI-owned 文件。即使版本 marker 相同，只要内嵌内容与项目 runtime 不同也 SHALL 更新，并在 file dependency 过期时重装依赖和清理 Vite optimization cache。

#### Scenario: marker 相同但内容变化

- **WHEN** CLI 与项目 marker 版本相同，但 CLI 内嵌的 Vite plugin 已更新
- **THEN** `localapp dev` SHALL 替换项目中的 CLI-owned plugin
- **AND** `node_modules/@localapp/app-kit` SHALL 与刷新后的 runtime 一致

#### Scenario: autoSync 已关闭

- **WHEN** 项目在 `.localapp/project-config.json` 设置 `autoSync: false`
- **THEN** 自动 postinstall sync 和 `localapp dev` 的隐式刷新 SHALL 跳过
- **AND** 显式 `localapp sync` 的行为 SHALL 仍由 runtime-zone-sync 规格控制

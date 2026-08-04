## ADDED Requirements

### Requirement: sync 同步 native runtime
`localapp sync` SHALL 同步 native runtime 所需的 vite plugin、DevShell、SDK 源码、样式 preset、mini-server 和 version.json。

#### Scenario: sync 后 runtime 为最新 native 版本
- **WHEN** 用户执行 `localapp sync`
- **THEN** `.localapp/runtime/` SHALL 包含 native DevShell 和 vite plugin
- **AND** `.localapp/runtime/version.json` SHALL 写入当前 CLI 版本

### Requirement: sync 移除旧 iframe runtime 假设
`localapp sync` SHALL NOT 在模板 runtime 中保留要求应用通过 iframe、`window.parent` 或 sandbox 运行的代码路径。

#### Scenario: runtime 不包含 iframe host
- **WHEN** sync 完成后扫描 `.localapp/runtime`
- **THEN** runtime SHALL NOT 包含默认 iframe wrapper 代码

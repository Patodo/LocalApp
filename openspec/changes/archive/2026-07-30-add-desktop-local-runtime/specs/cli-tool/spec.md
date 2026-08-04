## ADDED Requirements

### Requirement: 本地应用包构建命令

CLI SHALL 提供 `localapp build --package [--output <file>]`，执行本地 contract、migration、测试、构建和包校验并生成 `.localapp`。该命令 SHALL 不要求 Server URL、API Key 或远端账号。

#### Scenario: 离线构建应用包
- **WHEN** 用户在未配置 Server 的有效项目执行 `localapp build --package`
- **THEN** CLI SHALL 成功生成 `.localapp` 并输出包路径、应用 ID、版本和摘要
- **AND** SHALL NOT 发出远端网络请求

### Requirement: 本地安装命令

CLI SHALL 提供 `localapp local install <package>`，通过 Desktop Local Runtime 的受控安装协议安装 `.localapp`，并输出安装结果。Desktop 未运行或包校验失败时 SHALL 返回明确错误且不修改应用状态。

#### Scenario: 安装并打开本地应用
- **WHEN** Desktop 正在运行且用户执行 `localapp local install app.localapp`
- **THEN** CLI SHALL 安装应用并输出本地应用标识、版本和可打开状态

### Requirement: CLI 命名 Server 参数

CLI 的 `login`、`check`、`upload` 和 `verify` 流程 SHALL 接受命名 profile。未指定 profile 时 SHALL 保持现有兼容默认目标行为。

#### Scenario: 指定 profile 上传
- **WHEN** 用户执行 `localapp upload --profile production --verify`
- **THEN** CLI SHALL 使用 `production` 完成整个远程发布流程
- **AND** 输出 SHALL 标识实际目标 profile 和 Server URL

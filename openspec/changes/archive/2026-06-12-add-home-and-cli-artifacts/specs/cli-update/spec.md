## ADDED Requirements

### Requirement: CLI release 产物落盘

项目 SHALL 提供一个本地发布步骤，将 `cargo build --release` 生成的当前平台 CLI 二进制复制到 `packages/server/static/cli/{version}/`，文件名 MUST 与 server 下载接口使用的平台命名保持一致。

#### Scenario: Windows CLI 产物发布到静态目录

- **WHEN** 在 Windows x86_64 环境执行 CLI release 发布步骤
- **THEN** `packages/server/static/cli/{version}/localapp-cli-x86_64-pc-windows-msvc.exe` 文件存在
- **THEN** `GET /api/cli/download?os=windows&arch=x86_64&version={version}` 可定位到该文件

#### Scenario: Linux CLI 产物发布到静态目录

- **WHEN** 在 Linux x86_64 环境执行 CLI release 发布步骤
- **THEN** `packages/server/static/cli/{version}/localapp-cli-x86_64-unknown-linux-gnu` 文件存在
- **THEN** `GET /api/cli/download?os=linux&arch=x86_64&version={version}` 可定位到该文件

#### Scenario: macOS CLI 产物发布到静态目录

- **WHEN** 在 macOS x86_64 或 aarch64 环境执行 CLI release 发布步骤
- **THEN** 对应的 `localapp-cli-{target}` 文件存在于 `packages/server/static/cli/{version}/`
- **THEN** `GET /api/cli/download?os=macos&arch={arch}&version={version}` 可定位到该文件

### Requirement: CLI versions 清单更新

CLI release 发布步骤 SHALL 更新 `packages/server/static/cli/versions.json`，记录 `latest`、`min` 和当前版本的平台文件映射。更新后的清单 MUST 能被 `GET /api/cli/version` 返回。

#### Scenario: 发布步骤更新 latest

- **WHEN** CLI release 发布步骤完成
- **THEN** `versions.json` 的 `latest` 字段等于当前 Cargo package version
- **THEN** `versions.json` 的 `versions` 中包含当前版本

#### Scenario: 发布步骤保留既有平台条目

- **WHEN** `versions.json` 已包含同版本的其他平台二进制条目
- **THEN** CLI release 发布步骤只新增或覆盖当前平台条目
- **THEN** 其他平台条目仍然保留

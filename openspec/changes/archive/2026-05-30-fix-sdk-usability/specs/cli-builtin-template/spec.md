## ADDED Requirements

### Requirement: 内置模板解压后后处理依赖

CLI SHALL 在提取内置模板后，执行依赖后处理步骤：将 SDK 包源码拷贝到目标项目 `vendor/` 目录，并修改 `package.json` 将 `workspace:*` 替换为 `file:./vendor/{pkg-name}` 引用。

#### Scenario: workspace:* 替换为 file 引用

- **WHEN** 执行 `localapp init --name my-app` 提取内置模板
- **THEN** 目标项目 `package.json` 中 `@localapp/sdk` 的值为 `"file:./vendor/sdk-core"`，`@localapp/sdk-react` 的值为 `"file:./vendor/sdk-react"`，`@localapp/sdk-agent` 的值为 `"file:./vendor/sdk-agent"`

#### Scenario: vendor 目录包含 SDK 源码

- **WHEN** 模板提取完成后
- **THEN** 目标项目存在 `vendor/sdk-core/src/`、`vendor/sdk-react/src/`、`vendor/sdk-agent/src/` 目录，包含对应 SDK 包的完整源码和 `package.json`

#### Scenario: npm install 成功

- **WHEN** 在目标项目目录执行 `npm install`
- **THEN** 安装成功，无 `EUNSUPPORTEDPROTOCOL` 错误

#### Scenario: SDK 包中无残留 workspace:* 引用

- **WHEN** vendor 目录中的 SDK `package.json` 包含 `workspace:*` peerDependencies
- **THEN** CLI 后处理步骤 SHALL 将 vendor 内所有 `package.json` 中的 `workspace:*` 替换为对应版本号 `*`

# platform-version-compat Specification

## Purpose
定义应用 manifest 的平台版本范围，以及 CLI 检查、应用包构建和 canonical Server 安装阶段的一致兼容性校验。
## Requirements
### Requirement: manifest.json 声明 platformVersion

`manifest.json` SHALL 包含 `platformVersion` 字段,值为 semver range(如 `"^1.0"`、`">=1.0 <2.0"`)。该字段声明应用对平台版本的兼容性要求。

`localapp init` 创建的新项目 SHALL 写入当前平台的 platformVersion 范围(如 `"^1.0"`)。

#### Scenario: manifest 包含 platformVersion
- **WHEN** 查看 `manifest.json`
- **THEN** 文件包含 `"platformVersion": "^1.0"` 字段
- **AND** 值为合法 semver range

#### Scenario: 缺少 platformVersion 时 CLI 提示
- **WHEN** 用户在 manifest.json 中遗漏 platformVersion 字段
- **AND** 执行 `localapp check`、`localapp build --package` 或 `localapp db validate`
- **THEN** CLI 打印警告 "manifest.json missing platformVersion. Defaulting to current platform version '^1.0'."
- **AND** 继续执行,不阻断

### Requirement: Server 检查 platformVersion 兼容性

Server SHALL 在 `.localapp` 安装 staging 阶段解析 `platformVersion` 并与自身版本比较。版本范围不匹配 SHALL 拒绝安装并保持当前版本不变。

semver 兼容规则:
- 应用声明 `^1.0`,server 版本 1.x → 兼容
- 应用声明 `^1.0`,server 版本 2.0 → 主版本不匹配,拒绝
- 应用声明 `>=1.0 <2.0`,server 版本 1.5 → 兼容
- 应用声明 `^1.0`,server 版本 1.0 → 兼容

#### Scenario: 兼容的 platformVersion
- **WHEN** 应用 manifest 声明 `platformVersion: "^1.0"`
- **AND** 当前 server 版本 1.3
- **THEN** Server 接受应用包并正常安装

#### Scenario: 主版本不兼容拒绝
- **WHEN** 应用 manifest 声明 `platformVersion: "^1.0"`
- **AND** 当前 server 版本 2.0
- **THEN** Server 拒绝安装并返回错误 "Platform version mismatch. App requires ^1.0, server is 2.0. Please upgrade your app to support platform 2.0."
- **AND** CLI 打印错误退出

#### Scenario: 范围语法不合法
- **WHEN** manifest 声明 `platformVersion: "1.0"`(非合法 range)
- **THEN** CLI 在 validate 阶段提示 "Invalid platformVersion range"
- **AND** 阻断包构建或安装

### Requirement: localapp platform version 命令

`localapp platform version` SHALL 查询当前 server 的平台版本,与本地 manifest 声明对比,显示兼容状态。

#### Scenario: 查询平台版本
- **WHEN** 用户执行 `localapp platform version`
- **THEN** CLI 调用 `GET /api/platform/version` 拿到 server 版本
- **AND** 读取本地 manifest.json 的 platformVersion 字段
- **AND** 打印:
  ```
  Connected to: http://localapp.com
  Platform version: 1.3.2
  Your manifest declares: ^1.0
  Compatible: ✓
  ```

#### Scenario: 不兼容时提示
- **WHEN** 用户执行 `localapp platform version`,manifest 声明 `^1.0`,server 已升 2.0
- **THEN** CLI 打印兼容状态 `Compatible: ✗`
- **AND** 提示 "Run `localapp platform upgrade-guide` to learn how to migrate"

### Requirement: Server 升级时迁移平台数据库

Server 维护自己的 platform migrations，并在启动时对 Server-owned 平台数据库执行。平台 migration SHALL 只影响用户、群组、角色、应用注册、任务和其它平台状态，不得修改应用业务表；应用 migration 也不得修改平台数据库。

#### Scenario: Server 启动时应用 platform migration
- **WHEN** Server 升级且平台数据库存在尚未执行的 migration
- **THEN** Server SHALL 在开始监听前事务执行并记录该 migration
- **AND** 应用数据库 SHALL 保持不变

#### Scenario: platform migration 失败时启动失败
- **WHEN** Server 无法完成或验证自己的 platform migration
- **THEN** Server SHALL fail fast 并输出不含秘密的结构化错误
- **AND** SHALL NOT 以部分迁移的平台状态开始提供请求

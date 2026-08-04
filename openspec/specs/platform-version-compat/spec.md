# platform-version-compat Specification

## Purpose
TBD - created by archiving change local-mini-server-and-sql-migrations. Update Purpose after archive.
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
- **AND** 执行 `localapp upload` 或 `localapp db validate`
- **THEN** CLI 打印警告 "manifest.json missing platformVersion. Defaulting to current platform version '^1.0'."
- **AND** 继续执行,不阻断

### Requirement: server 检查 platformVersion 兼容性

server 端 SHALL 在 upload 接收 manifest 后,parse `platformVersion` 字段并与自身版本比较。主版本号不匹配 SHALL 拒绝 upload。

semver 兼容规则:
- 应用声明 `^1.0`,server 版本 1.x → 兼容
- 应用声明 `^1.0`,server 版本 2.0 → 主版本不匹配,拒绝
- 应用声明 `>=1.0 <2.0`,server 版本 1.5 → 兼容
- 应用声明 `^1.0`,server 版本 1.0 → 兼容

#### Scenario: 兼容的 platformVersion
- **WHEN** 应用 manifest 声明 `platformVersion: "^1.0"`
- **AND** 当前 server 版本 1.3
- **THEN** server 接受 upload,正常部署

#### Scenario: 主版本不兼容拒绝
- **WHEN** 应用 manifest 声明 `platformVersion: "^1.0"`
- **AND** 当前 server 版本 2.0
- **THEN** server 拒绝 upload,返回错误 "Platform version mismatch. App requires ^1.0, server is 2.0. Please upgrade your app to support platform 2.0."
- **AND** CLI 打印错误退出

#### Scenario: 范围语法不合法
- **WHEN** manifest 声明 `platformVersion: "1.0"`(非合法 range)
- **THEN** CLI 在 validate 阶段提示 "Invalid platformVersion range"
- **AND** 阻断 upload

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

### Requirement: server 升级时的统一迁移

server 维护 `platform-migrations/` 目录(在 server 仓库内,非应用项目)。每次 server 启动时 SHALL 检查所有 app.db 的 `_localapp_applied_platform_migrations` 表,应用未应用的 platform migration。

platform migration SHALL 只影响平台表(users、groups、roles),不影响应用表。

#### Scenario: server 启动时应用 platform migration
- **WHEN** server 启动,发现 1.3 版本的 `013_add_user_bio.sql` 未应用到某 app.db
- **THEN** server 在该 app.db 上运行该 platform migration
- **AND** 记录到 `_localapp_applied_platform_migrations`
- **AND** 继续启动流程

#### Scenario: platform migration 失败时 server 拒绝启动
- **WHEN** server 启动时某 app.db 应用 platform migration 失败
- **THEN** server 打印警告 "Failed to apply platform migration to <userId>/<pageName>"
- **AND** 标记该 app 为 "needs-migration-repair"
- **AND** 该 app 的 upload 被拒绝,直到管理员手动修复
- **AND** server 整体继续启动(不影响其他 app)


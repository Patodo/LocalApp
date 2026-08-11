## Purpose

定义 LocalApp CLI 面向一个 canonical Server 的连接、开发、检查、打包、安装和对等同步命令。

## Requirements

### Requirement: login 验证并保存命名 Server 连接

`localapp login` SHALL 收集或接收 Server URL 与 API Key，并在保存前用候选凭据请求 `GET /api/me`。验证成功后 SHALL 原子保存到指定或当前 profile；验证失败 SHALL 保持已有配置不变。CLI SHALL NOT 自动注册用户或读取共享 registration key。

#### Scenario: 非交互式登录成功

- **WHEN** 用户执行 `localapp login --server-url http://127.0.0.1:3000 --api-key <key> --profile local`
- **THEN** CLI SHALL 验证 API Key 对应用户
- **AND** SHALL 原子保存 `local` profile 并输出不含 API Key 的成功 JSON

#### Scenario: API Key 无效

- **WHEN** `GET /api/me` 返回未认证
- **THEN** CLI SHALL 返回明确错误且不覆盖任何 profile

### Requirement: Server profile 命令

CLI SHALL 提供 `localapp server add/list/use/remove` 管理命名 Server URL 和 API Key。列表与日志 SHALL NOT 输出凭据。需要远程 Server 的命令 SHALL 在开始时解析一次显式 profile、项目默认 profile或当前 profile，并在整个操作中复用。

#### Scenario: 选择默认 Server

- **WHEN** 用户执行 `localapp server use production`
- **THEN** 后续未指定 `--target` 或 `--profile` 的命令 SHALL 使用 `production`

#### Scenario: 列出连接

- **WHEN** 用户执行 `localapp server list`
- **THEN** 输出 SHALL 包含 profile 名与规范化 URL
- **AND** SHALL NOT 包含 API Key

### Requirement: dev 编排 canonical Server

`localapp dev` SHALL 启动打包后的 `localapp-server`、在项目下初始化真实开发用户、构建并通过正式安装端点安装唯一版本，再启动 Vite。CLI SHALL 监督两个子进程并在 Vite 退出时停止本次 Server。

#### Scenario: 启动开发应用

- **WHEN** 用户在有效项目执行 `localapp dev`
- **THEN** Server 数据 SHALL 位于 `tmp/localapp-dev/server/`
- **AND** `.localapp/dev-config.json` SHALL 指向唯一 Server
- **AND** 应用 API 与平台 API SHALL 由该 Server 提供

#### Scenario: Server 启动或安装失败

- **WHEN** Server 未就绪或开发包安装失败
- **THEN** CLI SHALL 返回非零退出码
- **AND** SHALL NOT 启动 Vite

### Requirement: check 提供可重复的发布前报告

`localapp check [--profile <name>] [--json]` SHALL 按 project、capabilities、migrations、backend、tests、build、dist 阶段检查应用。远程模式 SHALL 始终使用同一个已解析 Server；本地包构建 MAY 只执行不需要 Server 的检查。机器可读模式 SHALL 只向 stdout 输出一个 JSON 报告。

#### Scenario: JSON 检查成功

- **WHEN** 用户执行 `localapp check --profile local --json`
- **THEN** 输出 SHALL 包含每个阶段状态、输入摘要和 capability 摘要
- **AND** 退出码 SHALL 为 0

#### Scenario: 某阶段失败

- **WHEN** migration 或 backend contract 无效
- **THEN** 后续依赖阶段 SHALL 标记为 skipped 或 not-run
- **AND** 输出 SHALL 包含稳定诊断 code、文件和修复建议

### Requirement: build 生成可移植应用包

`localapp build --package [--output <file>]` SHALL 在本地完成项目检查、测试、构建和包校验并生成 `.localapp`。该命令 SHALL 不要求 Server URL、API Key 或账号。

#### Scenario: 离线构建

- **WHEN** 用户在未配置 Server 的有效项目执行 `localapp build --package`
- **THEN** CLI SHALL 生成确定性 `.localapp`
- **AND** 输出 SHALL 包含包路径、应用名、版本、SHA-256 和大小

### Requirement: app install 安装到明确 Server

`localapp app install --target <profile> [--package <path>]` SHALL 构建当前项目或读取显式 `.localapp`，先做本地包检查，再使用所选 profile 的 API Key POST 到 `/api/me/apps/install`。目标 API Key 用户 SHALL 成为目标端所有者；同名应用 SHALL 作为版本更新。

#### Scenario: 从当前项目安装

- **WHEN** 用户执行 `localapp app install --target local`
- **THEN** CLI SHALL 构建并校验包后安装到 `local`
- **AND** 输出 SHALL 标识 profile、Server URL、包路径和正式应用 URL

#### Scenario: 安装显式包

- **WHEN** 用户执行 `localapp app install --target staging --package app.localapp`
- **THEN** CLI SHALL 只接受 `.localapp` 扩展和有效包
- **AND** SHALL NOT从当前项目复制 loose 文件

### Requirement: app sync 由源 Server 推送到对等 Server

`localapp app sync --peer <name> [--target <source-profile>]` SHALL 请求源 Server 把当前应用包推送给它已保存的 peer。CLI SHALL NOT 读取、复制或转发目标 peer API Key。默认只同步应用版本包、manifest、migrations 和 backend contract。

#### Scenario: 应用版本同步

- **WHEN** 用户执行 `localapp app sync --peer office --target local`
- **THEN** `local` Server SHALL 发起应用级同步
- **AND** 目标数据库、上传文件、用户和权限 SHALL 保持不变

#### Scenario: 显式同步应用和数据

- **WHEN** 用户执行 `localapp app sync --peer office --with-data --confirm-app notes`
- **AND** manifest 应用名为 `notes`
- **THEN** 源 Server SHALL 启动一致性快照同步
- **AND** 目标 SHALL 在备份后整体替换该应用数据库和文件并在失败时回滚

#### Scenario: 数据同步确认不匹配

- **WHEN** `--confirm-app` 与 manifest 应用名不一致或缺失
- **THEN** CLI SHALL 在发出同步请求前拒绝操作

### Requirement: schema 命令不再写平台状态

应用 schema SHALL 由 backend contract 和 migrations 管理。`localapp schemas` SHALL 返回弃用说明；受支持的 scaffold 命令 SHALL 写入 `backend/resources/<name>/`，不得直接创建 Server schema。

#### Scenario: 调用旧 schemas 命令

- **WHEN** 用户执行 `localapp schemas create tasks`
- **THEN** CLI SHALL 返回非零退出码并提示编辑 backend contract

#### Scenario: 生成 resource scaffold

- **WHEN** 用户执行受支持的 schema/backend scaffold 命令
- **THEN** CLI SHALL 创建带 `$schema` 的 resource、queries 和 mutations 文件

### Requirement: runtime sync 与 eject

`localapp sync` SHALL 精确刷新 CLI 管理的 `.localapp/runtime/` 和 LocalApp skills，同时保留用户代码和自定义 skills。`localapp eject` SHALL 通过项目名确认后把 CLI 领地转为用户维护代码，并永久禁用自动 sync。

#### Scenario: dev 前刷新 CLI 领地

- **WHEN** 内嵌 runtime 内容已变化但版本 marker 相同
- **THEN** `localapp dev` SHALL 仍刷新 CLI 拥有文件并同步 file dependencies
- **AND** SHALL 移除已废弃 runtime 文件

#### Scenario: eject 后同步

- **WHEN** 已 eject 项目执行 `localapp sync`
- **THEN** CLI SHALL 拒绝修改项目并返回明确错误

### Requirement: 离线 db 命令不提供应用服务

`localapp db migrate/reset/status/types/shell` SHALL 只操作 `tmp/localapp-schema/schema.db`。针对 Server 的 validate、restore 等操作 SHALL 使用已解析连接并由 Server 执行权限和数据边界检查。

#### Scenario: 重建 schema 工作库

- **WHEN** 用户执行 `localapp db reset`
- **THEN** CLI SHALL 只重建项目下的离线 schema 工作库
- **AND** SHALL NOT修改 canonical Server 的应用数据库

### Requirement: 数据库恢复要求双重破坏性确认

`localapp db restore --backup <name>` SHALL 要求同时提供 `--i-know-this-loses-data` 和 `--confirm-project-name <exact manifest name>`。任一参数缺失或名称不完全匹配时，CLI SHALL 在发出 Server 请求前拒绝恢复。Server SHALL 拒绝不存在的备份，并保持当前数据库不变。

#### Scenario: 恢复确认缺失或不匹配

- **WHEN** 用户未提供破坏性确认，或确认名称与 `manifest.json` 不完全一致
- **THEN** CLI SHALL 返回包含完整确认命令的错误
- **AND** SHALL NOT 调用 `/api/db/restore`

#### Scenario: 目标备份不存在

- **WHEN** 用户确认恢复但 Server 上没有指定备份
- **THEN** Server SHALL 返回 404 和明确错误
- **AND** 当前应用数据库 SHALL 字节级保持不变

### Requirement: 保留当前项目与页面辅助命令

CLI SHALL 提供 `localapp new`、`localapp pages list/info/delete`、`localapp generate schema/page/component` 和 `localapp migrate-from-manifest`。这些命令 SHALL 复用 canonical Server/profile 或修改当前项目源码，不得启动或调用第二套后端。

#### Scenario: 生成项目脚手架

- **WHEN** 用户执行 `localapp generate schema tasks`、`generate page reports` 或 `generate component Card`
- **THEN** CLI SHALL 在当前项目中生成对应 backend/page/component 骨架
- **AND** SHALL NOT 修改 Server 运行时数据

#### Scenario: 管理已安装页面

- **WHEN** 用户执行 `localapp pages list`、`info` 或 `delete`
- **THEN** CLI SHALL 使用一次解析的 Server 连接和正常权限检查

### Requirement: 保留身份、验证、更新与管理命令

CLI SHALL 提供 `localapp whoami`、`logout`、`update`、`verify` 和 `admin users/pages/stats`。`verify` SHALL 从正式 `/<owner>/<app>/` 路径执行隔离身份 smoke test；admin 子命令 SHALL 要求目标 Server 管理员权限；任何命令 SHALL NOT 输出 API Key。

#### Scenario: 查看和清除当前身份

- **WHEN** 用户依次执行 `localapp whoami` 和 `localapp logout`
- **THEN** CLI SHALL 先显示当前 Server 用户，再从本地配置清除凭据
- **AND** SHALL NOT 在输出中显示被清除的 API Key

#### Scenario: 普通用户调用管理命令

- **WHEN** 非管理员执行 `localapp admin users`、`pages` 或 `stats`
- **THEN** Server SHALL 返回 403
- **AND** CLI SHALL 以非零状态结束

### Requirement: 已移除的发布命令不存在

CLI SHALL NOT 暴露旧的 loose-file 发布命令、旧原生客户端安装命令或任何第二后端启动命令，也 SHALL NOT 为其提供兼容 alias。

#### Scenario: 调用已移除命令

- **WHEN** 用户尝试调用旧发布或旧原生客户端本地安装命令
- **THEN** clap SHALL 将其视为未知命令并返回非零退出码
- **AND** 帮助 SHALL 指向 `localapp app install` 或 `localapp dev`

### Requirement: 命令输出与凭据边界

成功命令 SHALL 向 stdout 输出 JSON 或明确的结构化结果；错误 SHALL 输出到 stderr 并返回非零退出码。任何输出、错误或日志 SHALL NOT 包含 API Key、session、peer credential 或 Server master key。

#### Scenario: 安装输出

- **WHEN** `localapp app install` 成功
- **THEN** stdout SHALL 包含安装目标和结果
- **AND** SHALL NOT包含用于安装的 API Key

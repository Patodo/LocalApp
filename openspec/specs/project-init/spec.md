## Purpose

定义 CLI 从内置或 Server 配置的模板创建完整应用项目，并可选择通过 `.localapp` 包安装到明确 Server 的初始化流程。

## Requirements

### Requirement: init 生成完整项目和 CLI 领地

`localapp init --name <name>` SHALL 创建应用源码、`manifest.json`、migrations、backend contract、Agent 指引和 CLI 领地。CLI 领地 SHALL 包含 `.localapp/runtime/`、`.claude/skills/localapp*/` 和 `agent-tool-patterns/`，并在 `.localapp/runtime/version.json` 写入当前 CLI 版本。

#### Scenario: 使用内置模板初始化

- **WHEN** 用户执行 `localapp init --name my-app --builtin-repo --skip-deploy`
- **THEN** CLI SHALL 从内置模板创建完整项目
- **AND** SHALL 写入应用名、默认 `distDir`、`platformVersion` 和 backend root
- **AND** SHALL 包含可重建的 runtime 与 Agent skills

#### Scenario: 使用 Server 模板仓库

- **WHEN** 已选 Server 的 `/api/config` 返回有效 `templateRepoUrl` 且 Git 可用
- **THEN** 默认 init SHALL clone 该模板并移除上游 remote
- **AND** clone 失败时 SHALL 清理本次部分目录并回退内置模板

#### Scenario: Server 未配置模板仓库

- **WHEN** `/api/config` 返回空 `templateRepoUrl`
- **THEN** CLI SHALL 直接使用内置模板

### Requirement: init name 与目标目录安全

应用名 SHALL 使用与 Server 一致的规则：以小写字母开头，仅含小写字母、数字和单连字符，总长 3 至 63，且不得使用保留词。CLI SHALL 拒绝覆盖已有非空目标目录。

#### Scenario: 合法 name

- **WHEN** 用户执行 `localapp init --name my-cool-app`
- **THEN** CLI SHALL 创建 `my-cool-app/manifest.json`
- **AND** manifest 的 `name` SHALL 为 `my-cool-app`

#### Scenario: 非法或冲突目标

- **WHEN** name 包含大写字母、数字开头、连续连字符或命中保留词，或目标目录已存在
- **THEN** CLI SHALL 在写入项目前返回明确错误

### Requirement: 初始化部署使用应用包安装

未指定 `--skip-deploy` 时，init SHALL 要求已解析的 Server 连接，安装依赖，运行本地检查和构建，生成 `.localapp`，再调用该 Server 的 `/api/me/apps/install`。init SHALL NOT 预创建空页面、发送 loose dist 文件或使用另一套本地服务。

#### Scenario: 已配置用户执行完整 init

- **WHEN** 用户已登录一个 Server 并执行 `localapp init --name my-app`
- **THEN** CLI SHALL 创建项目并安装依赖
- **AND** SHALL 构建 `my-app.localapp` 并通过正式安装端点安装
- **AND** 最终 JSON SHALL 返回创建结果和 Server 安装信息

#### Scenario: 安装失败

- **WHEN** Server 拒绝包或无法连接
- **THEN** CLI SHALL 返回非零退出码和明确错误
- **AND** SHALL 保留已生成项目以便修复后执行 `localapp app install`

#### Scenario: 未配置 Server

- **WHEN** 用户未配置 Server 且未指定 `--skip-deploy`
- **THEN** init SHALL 提示先执行 `localapp login`
- **AND** SHALL NOT 猜测或自动创建远程用户

### Requirement: skip-deploy 提供完整离线项目

`--skip-deploy` SHALL 不要求 Server URL、API Key 或 Git。该模式 SHALL 使用内置模板完成脚手架与可选依赖安装，不构建或安装应用包。若已有当前连接，`.localapp/dev-config.json` MAY 暂存其 Server URL；否则写入空 `serverUrl`。

#### Scenario: 无配置离线初始化

- **WHEN** 用户在无 Server 配置环境执行 `localapp init --name my-app --skip-deploy`
- **THEN** CLI SHALL 成功创建项目
- **AND** `.localapp/dev-config.json` SHALL 只包含空 `serverUrl`
- **AND** SHALL 提示后续使用 `localapp dev` 或 `localapp app install`

#### Scenario: 跳过依赖安装

- **WHEN** 用户同时指定 `--skip-deploy --skip-install`
- **THEN** CLI SHALL 创建全部项目文件但不运行包管理器
- **AND** SHALL 提示手动安装依赖

### Requirement: init 配置 runtime 自动同步

生成项目的 `package.json` SHALL 包含 `postinstall` 钩子 `localapp sync --quiet 2>/dev/null || true`。持久项目策略 SHALL 位于 `.localapp/project-config.json`；默认文件可不存在且表示开启自动同步。用户可通过 `localapp sync --off` 显式写入 `autoSync: false`。临时 `.localapp/dev-config.json` SHALL NOT 承载 `autoSync` 或 `ejected`。

#### Scenario: clone 后安装依赖

- **WHEN** 用户 clone 一个未提交 `.localapp/runtime/` 的项目并运行依赖安装
- **THEN** postinstall SHALL 尝试恢复当前 CLI 版本的 runtime 和 skills
- **AND** CLI 不在 PATH 时 SHALL NOT 阻断依赖安装

#### Scenario: 默认开发配置

- **WHEN** init 完成
- **THEN** `.localapp/dev-config.json` SHALL 包含 `serverUrl`
- **AND** SHALL NOT 默认写入 `autoSync: false`
- **AND** `.localapp/project-config.json` MAY 不存在，缺省策略 SHALL 等同自动同步开启且项目未 eject

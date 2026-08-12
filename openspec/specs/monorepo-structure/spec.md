## Purpose

定义以单一公开 `localapp` npm 包为用户发行边界的 pnpm monorepo 结构、内部 workspace 依赖方向、模板来源、native adapter 边界和废弃 package 清理规则。

## Requirements

### Requirement: pnpm workspace 管理 TypeScript 包

项目 SHALL 使用 pnpm workspace 管理 `packages/localapp`、`packages/server`、
`packages/server-core`、`packages/web` 和 SDK 包。`packages/localapp` SHALL 是唯一公开
安装入口；`packages/server` SHALL 作为其内部运行时被打包，不作为第二个用户产品。

#### Scenario: 工作空间配置生效

- **WHEN** 在项目根目录执行 `pnpm install`
- **THEN** pnpm SHALL 安装当前 TypeScript 子包并通过 `workspace:*` 链接内部依赖

#### Scenario: 单一 npm 包构建

- **WHEN** 执行 `pnpm -C packages/localapp build:package`
- **THEN** SHALL 生成同时包含 CLI、Server、Web、模板和当前平台 adapter 的 npm artifact

### Requirement: 唯一 CLI 是 TypeScript CLI

`packages/localapp` SHALL 暴露唯一 `localapp` bin。仓库 SHALL NOT 保留独立 Rust CLI、
Desktop/Tauri package、Local Runtime package 或独立用户可安装的 Server launcher。

#### Scenario: CLI 子包结构

- **WHEN** 查看 `packages/localapp/`
- **THEN** SHALL 存在 `package.json`、TypeScript CLI 源码、daemon 与打包脚本
- **AND** CLI SHALL 通过 Node.js 执行

#### Scenario: 原生代码边界

- **WHEN** 查看 `packages/localapp/native/`
- **THEN** 原生代码 SHALL 只实现 Scheme、通知与必要的操作系统注册
- **AND** SHALL NOT 实现 CLI 命令、Server、应用托管或认证

### Requirement: init-repo 是内置模板源

`init-repo/` SHALL 作为内置应用模板源存在于 monorepo 根目录。打包流程 SHALL 把受管
模板复制到 npm artifact；用户从 tgz 执行 `localapp init` 时不得依赖外部模板仓库。

#### Scenario: 模板可独立构建

- **WHEN** 从 npm tgz 初始化项目并安装依赖
- **THEN** 项目 SHALL 可构建并生成 `dist/`

### Requirement: 废弃 package 物理删除

功能迁移完成后，废弃 package SHALL 从工作树、workspace、根 scripts、Dockerfile 和
发行 workflow 中物理删除；历史仅通过 Git 检索。

#### Scenario: 工作树无旧产品边界

- **WHEN** 单一 npm 包迁移完成
- **THEN** 独立 CLI、Desktop、Local Runtime 与模板运行时 package SHALL 不存在

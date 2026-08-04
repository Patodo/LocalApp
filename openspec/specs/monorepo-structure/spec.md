## Purpose

Monorepo 项目结构。使用 pnpm workspace 管理 TypeScript 子包（shared、server、client），Rust CLI 子包由 Cargo 独立管理。

## Requirements

### Requirement: pnpm workspace monorepo 结构

项目 SHALL 使用 pnpm workspace 管理 server、client 两个 TypeScript 子包。根目录的 pnpm-workspace.yaml MUST 声明 `packages/*` 为工作空间目录。packages/cli 为 Rust 项目，由 Cargo 独立管理。类型定义已内联至 server/src/types/ 目录。

#### Scenario: 工作空间配置生效
- **WHEN** 在项目根目录执行 `pnpm install`
- **THEN** pnpm 识别并安装 server、client 两个子包的依赖，内部依赖通过 `workspace:*` 协议链接

#### Scenario: 子包可独立运行
- **WHEN** 在任一 TypeScript 子包目录执行 `pnpm dev`
- **THEN** 使用 tsx 直接运行该子包的 TypeScript 入口文件，无需预编译

#### Scenario: client 子包结构
- **WHEN** 查看 `packages/client/` 目录
- **THEN** 包含 `src/index.ts`、`package.json`、`tsconfig.json`，package.json 中 name 为 `@localapp/client`

#### Scenario: server 子包包含类型定义
- **WHEN** 查看 `packages/server/src/types/` 目录
- **THEN** 包含 models.ts、api.ts，定义了核心数据模型和 API 契约类型

### Requirement: TypeScript 项目引用配置

根 tsconfig.json MUST 配置 `references` 指向 server 和 client 子包。每个子包的 tsconfig.json MUST 设置 `composite: true`。

#### Scenario: 增量编译
- **WHEN** 仅修改了 server 包中的类型定义
- **THEN** 执行 `pnpm build` 时，仅 server 包和依赖它的子包被重新编译

#### Scenario: 依赖方向强制执行
- **WHEN** server 包中的代码尝试直接 import 不在其依赖中的模块
- **THEN** TypeScript 编译器报错，阻止非法依赖

### Requirement: 子包目录结构

每个 TypeScript 子包 MUST 包含以下文件：`src/index.ts`（主入口）、`package.json`（包配置）、`tsconfig.json`（TypeScript 配置）。

#### Scenario: server 子包结构
- **WHEN** 查看 `packages/server/` 目录
- **THEN** 包含 `src/index.ts`、`package.json`、`tsconfig.json`，package.json 中 name 为 `@localapp/server`，不依赖 `@localapp/shared`

### Requirement: CLI 子包结构（Rust）

packages/cli SHALL 为独立 Rust 项目，拥有自己的 `Cargo.toml`，不纳入 pnpm workspace 管理。

#### Scenario: CLI 子包为 Rust 项目
- **WHEN** 查看 `packages/cli/` 目录
- **THEN** 包含 `Cargo.toml`（Rust 项目配置）、`src/main.rs`（CLI 入口），不包含 package.json 或 tsconfig.json

#### Scenario: CLI 独立构建
- **WHEN** 在 `packages/cli/` 目录执行 `cargo build --release`
- **THEN** 编译生成 `localapp` 二进制文件，无需 Node.js/pnpm 环境

### Requirement: init-repo 模板目录定位

`init-repo/` SHALL 作为项目模板的源目录存在于 monorepo 根目录，不属于 pnpm workspace。其内容由本项目的 SDK 源码和模板文件组成，供手动同步到远程模板仓库，供 `localapp init` 命令 git clone 使用。

#### Scenario: init-repo 不参与 pnpm 管理
- **WHEN** 在项目根目录执行 `pnpm install`
- **THEN** `init-repo/` 目录不被 pnpm 处理，不影响 workspace 依赖解析

#### Scenario: init-repo 包含完整可运行项目
- **WHEN** 将 `init-repo/` 的内容复制到新目录并执行 `npm install && npm run build`
- **THEN** 成功构建生成 `dist/` 目录

### Requirement: 废弃 package 的彻底清理

当一个 TypeScript 子包被标记为 DEPRECATED 且其功能已迁移到其他 package 时，该 package SHALL 从仓库中**物理删除**，而不只是保留代码 + 加 DEPRECATED.md 标记。pnpm-workspace.yaml、root package.json 的 build scripts、Dockerfile 的 COPY 行 MUST 同步移除对该包的所有引用。

**理由**：保留废弃代码会持续制造歧义——贡献者和 AI 工具容易把改动错误地写进不再被构建/服务的代码。git 历史已经提供了完整的可追溯性，仓库工作树只应保留"当前生效"的代码。

#### Scenario: 工作树不保留废弃 package
- **WHEN** 一个 package 的功能已迁移到 `packages/web/`，且自身不再被任何其他 package `import`
- **THEN** 该 package 的目录（含 src/、package.json、tsconfig.json、构建配置、DEPRECATED.md）MUST 不存在于工作树中

#### Scenario: workspace 配置同步清理
- **WHEN** 一个 package 被从仓库删除
- **THEN** `pnpm-workspace.yaml` 中 MUST 不再包含该 package 的路径条目

#### Scenario: build scripts 同步清理
- **WHEN** 一个 package 被从仓库删除
- **THEN** root `package.json` 的 scripts 段 MUST 不再包含针对该 package 的构建命令（如 `build:<name>`）

#### Scenario: Dockerfile 同步清理
- **WHEN** 一个 package 被从仓库删除
- **THEN** `Dockerfile` MUST 不再 `COPY` 该 package 的任何文件

#### Scenario: 仓库可追溯性
- **WHEN** 需要查看已删除 package 的历史代码
- **THEN** 通过 `git show` / `git log -- <path>` 从历史提交中检索，不依赖工作树

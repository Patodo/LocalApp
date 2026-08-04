## MODIFIED Requirements

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
- **THEN** 包含 models.ts、api.ts、mcp.ts，定义了核心数据模型、API 契约和 MCP Tool 类型

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

## REMOVED Requirements

### Requirement: shared 子包目录结构
**Reason**: shared 包类型定义已内联至 server/src/types/，不再需要独立子包
**Migration**: 类型文件从 `packages/shared/src/` 迁移至 `packages/server/src/types/`

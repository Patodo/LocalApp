## MODIFIED Requirements

### Requirement: pnpm workspace monorepo 结构

项目 SHALL 使用 pnpm workspace 管理 shared、server、client 三个 TypeScript 子包。根目录的 pnpm-workspace.yaml MUST 声明 `packages/*` 为工作空间目录。packages/client 为新增的 React SDK 子包。packages/cli 为 Rust 项目，由 Cargo 独立管理。

#### Scenario: 工作空间配置生效
- **WHEN** 在项目根目录执行 `pnpm install`
- **THEN** pnpm 识别并安装 shared、server、client 三个子包的依赖，内部依赖通过 `workspace:*` 协议链接

#### Scenario: 子包可独立运行
- **WHEN** 在任一 TypeScript 子包目录执行 `pnpm dev`
- **THEN** 使用 tsx 直接运行该子包的 TypeScript 入口文件，无需预编译

#### Scenario: client 子包结构
- **WHEN** 查看 `packages/client/` 目录
- **THEN** 包含 `src/index.ts`、`package.json`、`tsconfig.json`，package.json 中 name 为 `@localapp/client`

## ADDED Requirements

### Requirement: init-repo 模板目录定位

`init-repo/` SHALL 作为项目模板的源目录存在于 monorepo 根目录，不属于 pnpm workspace。其内容由本项目的 SDK 源码和模板文件组成，供手动同步到远程模板仓库，供 `localapp init` 命令 git clone 使用。

#### Scenario: init-repo 不参与 pnpm 管理
- **WHEN** 在项目根目录执行 `pnpm install`
- **THEN** `init-repo/` 目录不被 pnpm 处理，不影响 workspace 依赖解析

#### Scenario: init-repo 包含完整可运行项目
- **WHEN** 将 `init-repo/` 的内容复制到新目录并执行 `npm install && npm run build`
- **THEN** 成功构建生成 `dist/` 目录

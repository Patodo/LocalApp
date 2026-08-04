## Context

LocalApp 是一个企业内部的前端页面托管平台，采用本地 MCP 客户端 + 远程 HTTP 服务器的架构。此变更建立项目基础结构，包括 monorepo 配置、TypeScript 工具链和共享类型系统。所有后续功能变更（server-core、server-crud、mcp-client）都依赖此基础。

当前状态：空白 Git 仓库，仅有 openspec 配置和讨论文档。

## Goals / Non-Goals

**Goals:**

- 建立 pnpm workspace monorepo，三个子包可独立开发、构建和发布
- shared 包提供所有跨包使用的 TypeScript 类型定义
- TypeScript 严格模式，统一的代码风格
- 开发时使用 tsx 直接运行，无需预编译
- 构建时使用 tsc 输出标准 CommonJS + 类型声明

**Non-Goals:**

- 不涉及任何业务逻辑实现
- 不配置测试框架（在后续变更中按需引入）
- 不配置 CI/CD（部署脚本在后续变更中处理）
- 不配置 linting/formatting（可后续补充 eslint + prettier）

## Decisions

### 1. pnpm workspace 作为 monorepo 方案

选择 pnpm workspace 而非 turborepo / nx / lerna。

理由：
- 三个子包，规模小，不需要任务编排
- pnpm 原生 workspace，零额外依赖
- 内部依赖通过 `workspace:*` 协议引用
- pnpm 的硬链接机制节省磁盘空间

### 2. TypeScript 项目引用（Project References）

根 tsconfig.json 配置 `references` 指向三个子包，子包使用 `composite: true`。

理由：
- tsc 增量编译，只重编译变更的包
- 依赖关系在 TypeScript 层面强制执行（mcp-client 引用 shared，不能直接引用 server 的内部实现）
- IDE 跳转和类型提示开箱即用

### 3. shared 包类型导出方式

使用 `export type *` 从 barrel 文件导出，子包通过 `@localapp/shared` 引用。

类型组织方式：
```
shared/src/
  api.ts        ← HTTP API 请求/响应类型
  models.ts     ← 数据模型类型（Page、Schema、Version 等）
  mcp.ts        ← MCP Tool 参数和返回值类型
  index.ts      ← barrel 导出
```

### 4. 子包入口结构

每个子包统一的入口结构：
```
packages/<name>/
  src/
    index.ts    ← 主入口
  package.json
  tsconfig.json
```

server 和 mcp-client 的 package.json 中配置：
- `main`: `dist/index.js`（构建产物）
- `types`: `dist/index.d.ts`
- `scripts.dev`: `tsx src/index.ts`（开发运行）
- `scripts.build`: `tsc`（构建）

## Risks / Trade-offs

- **[shared 包变更影响全局]** → shared 类型变更需要重新构建所有依赖包。开发时使用 tsx 直接运行 TS，绕过构建步骤；发布时通过 tsc 编译确保类型安全。
- **[TypeScript 项目引用配置复杂度]** → 初期配置需仔细处理 paths 和 references，但一旦配置正确，后续开发体验好。使用统一的 tsconfig.base.json 减少重复配置。

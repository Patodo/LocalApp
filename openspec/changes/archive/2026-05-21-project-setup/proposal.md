## Why

LocalApp 项目需要开发一个前端页面托管平台，包含本地 MCP 客户端和远程 HTTP 服务器两个部署单元。在开始功能开发之前，需要先建立 monorepo 项目结构、TypeScript 配置、以及三个子包（mcp-client、server、shared）之间的共享类型定义。这是所有后续变更的基础。

## What Changes

- 创建 pnpm workspace monorepo 项目结构
- 配置根级和子包级 TypeScript 配置
- 创建 `packages/shared` 子包，定义所有共享类型：
  - API 请求/响应类型（上传、页面管理、schema 管理）
  - 数据模型类型（页面元信息、schema 定义、CRUD 操作）
  - MCP Tool 参数和返回值类型
- 创建 `packages/server` 子包骨架（Fastify 服务入口）
- 创建 `packages/mcp-client` 子包骨架（MCP Server 入口）
- 配置开发工具链（tsx 开发运行、tsc 构建）

## Capabilities

### New Capabilities

- `monorepo-structure`: pnpm workspace monorepo 结构，包含 shared、server、mcp-client 三个子包的目录组织和依赖关系
- `shared-types`: 共享类型定义系统，涵盖 API 接口、数据模型、MCP 工具参数等所有跨包使用的 TypeScript 类型

### Modified Capabilities

（无，这是首个变更）

## Impact

- 新增项目根配置文件（package.json、tsconfig.json、pnpm-workspace.yaml）
- 新增三个子包目录（packages/shared、packages/server、packages/mcp-client）
- 后续所有变更都依赖此基础结构

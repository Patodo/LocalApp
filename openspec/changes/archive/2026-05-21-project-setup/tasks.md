## 1. Monorepo 基础配置

- [x] 1.1 创建根 package.json（pnpm workspace 配置、scripts）
- [x] 1.2 创建 pnpm-workspace.yaml（声明 packages/*）
- [x] 1.3 创建根 tsconfig.base.json（公共 TypeScript 配置：strict、composite、paths）
- [x] 1.4 创建根 tsconfig.json（项目引用 references 指向三个子包）

## 2. shared 子包

- [x] 2.1 创建 packages/shared/package.json（name: @localapp/shared、main、types、exports）
- [x] 2.2 创建 packages/shared/tsconfig.json（继承 base，composite: true）
- [x] 2.3 创建 packages/shared/src/models.ts（Page、Version、Schema、SchemaField 类型）
- [x] 2.4 创建 packages/shared/src/api.ts（UploadRequest、PageInfoResponse、SchemaCreateRequest 等请求/响应类型）
- [x] 2.5 创建 packages/shared/src/mcp.ts（upload_page、create_schema、list_pages 等 tool 参数和返回值类型）
- [x] 2.6 创建 packages/shared/src/index.ts（barrel 导出所有类型）

## 3. server 子包

- [x] 3.1 创建 packages/server/package.json（name: @localapp/server、依赖 fastify、@localapp/shared）
- [x] 3.2 创建 packages/server/tsconfig.json（继承 base、composite: true、reference shared）
- [x] 3.3 创建 packages/server/src/index.ts（Fastify 服务骨架入口）

## 4. mcp-client 子包

- [x] 4.1 创建 packages/mcp-client/package.json（name: @localapp/mcp-client、依赖 @modelcontextprotocol/sdk、@localapp/shared）
- [x] 4.2 创建 packages/mcp-client/tsconfig.json（继承 base、composite: true、reference shared）
- [x] 4.3 创建 packages/mcp-client/src/index.ts（MCP Server 骨架入口）

## 5. 验证

- [x] 5.1 执行 pnpm install，确认 workspace 依赖正确链接
- [x] 5.2 执行 pnpm build，确认所有子包 TypeScript 编译通过
- [x] 5.3 在 server 中 import @localapp/shared 的类型，确认跨包引用正常

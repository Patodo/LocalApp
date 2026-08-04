## Context

mcp-client 包已有骨架代码（`packages/mcp-client/src/index.ts`），使用 `@modelcontextprotocol/sdk` 的 McpServer + StdioServerTransport。共享类型定义在 `packages/shared/src/mcp.ts` 中。server-crud-refactor 完成后，CRUD 路径将变为 `/serve/{userId}/{pageId}/api/{resource}`。

当前状态：骨架已搭建，package.json 已配置 bin 入口和依赖。需要实现 5 个 MCP Tool 的具体逻辑。

## Goals / Non-Goals

**Goals:**

- 实现 5 个 MCP Tool（upload_page、create_schema、list_pages、delete_page、get_page_info）
- 通过环境变量配置服务器地址和 API Key
- upload_page 支持递归读取本地目录并通过 multipart 上传
- create_schema 返回 CRUD 端点信息

**Non-Goals:**

- 不实现 update_schema / delete_schema MCP Tool（低频操作，用户可直接调 HTTP API）
- 不实现配置文件管理（只用环境变量）
- 不实现离线缓存或重试机制

## Decisions

### 1. 配置通过环境变量

```
LOCALAPP_SERVER_URL = http://192.168.1.100:3000
LOCALAPP_API_KEY = abc123...
```

理由：MCP 配置中直接设置 env 即可，无需额外的配置文件或 init 命令。适合 CLI 工具场景。

### 2. HTTP 请求使用原生 fetch

Node 18+ 内置 fetch，MCP SDK 要求 Node 18+，无需额外依赖。

### 3. upload_page 实现方式

递归读取本地目录，收集所有文件的相对路径和内容，通过 multipart/form-data 发送到 `POST /api/upload`。

```
upload_page(path="./dist", pageId?)
  │
  ├── 递归遍历目录
  │   收集 [{ filename: "index.html", buffer }, { filename: "assets/main.js", buffer }]
  │
  ├── POST {serverUrl}/api/upload
  │   Content-Type: multipart/form-data
  │   X-API-Key: {apiKey}
  │   fields: pageId (if provided)
  │   files: 所有文件
  │
  └── 返回 { pageId, url, version }
```

使用 `undici` 或手动构建 multipart body（原生 fetch 不直接支持 multipart 上传）。实际用 `FormData` + `fetch` 即可。

### 4. create_schema 返回 endpoints

调用 `POST /api/schemas` 后，再调 `GET /api/pages/:pageId` 获取 userId，拼接完整的 CRUD 端点 URL。

### 5. MCP Tool 注册方式

使用 `@modelcontextprotocol/sdk` 的 `server.tool()` 方法注册，参数用 zod schema 定义。

### 6. 代码组织

```
packages/mcp-client/src/
  index.ts        ← 入口，MCP server 启动
  tools.ts        ← Tool 注册
  api-client.ts   ← HTTP 请求封装（fetch wrapper）
```

## Risks / Trade-offs

- **[原生 fetch + FormData]** Node 的 FormData 在 multipart 上传时行为可能与浏览器不同，需要测试。备选方案是用 `undici` 的 FormData 或 `node-fetch`。
- **[大文件上传]** upload_page 一次性读取所有文件到内存。50MB 限制下可接受。
- **[无状态]** 每个 Tool 调用独立，不缓存 userId。每次需要时通过 API 获取。

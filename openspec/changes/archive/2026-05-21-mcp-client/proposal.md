## Why

server-core 和 server-crud 已实现了完整的页面托管和 CRUD API，但用户需要通过 AI 编码工具（Claude Code）调用这些功能。MCP client 作为本地 stdio 服务器，让 AI 工具能够通过 MCP 协议上传前端页面、管理 Schema、查看页面列表。

## What Changes

- 实现 MCP client stdio 服务器，注册 5 个 MCP Tool
- `upload_page`：读取本地目录，通过 HTTP multipart 上传到远程服务器
- `create_schema`：为页面创建数据 Schema
- `list_pages`：列出用户的所有页面
- `delete_page`：删除页面
- `get_page_info`：获取页面详情
- 通过环境变量 `LOCALAPP_SERVER_URL` 和 `LOCALAPP_API_KEY` 配置连接

## Capabilities

### New Capabilities

- `mcp-tools`: MCP Tool 集合，包括 upload_page、create_schema、list_pages、delete_page、get_page_info

### Modified Capabilities

（无修改）

## Impact

- `packages/mcp-client/src/` 新增 MCP tool 实现（当前只有骨架）
- `packages/mcp-client/package.json` 可能需要新增依赖
- 依赖 server-crud-refactor 完成后的新 CRUD 路径格式

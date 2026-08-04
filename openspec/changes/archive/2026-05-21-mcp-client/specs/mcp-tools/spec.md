## ADDED Requirements

### Requirement: upload_page

MCP Tool `upload_page` SHALL 将本地目录的文件通过 HTTP multipart 上传到远程服务器。

#### Scenario: 成功上传
- **WHEN** 调用 `upload_page(path="./dist")` 且 `LOCALAPP_SERVER_URL` 和 `LOCALAPP_API_KEY` 已配置
- **THEN** 递归读取 path 下所有文件，POST 到 `/api/upload`，返回 `{ pageId, url, version }`

#### Scenario: 指定 pageId
- **WHEN** 调用 `upload_page(path="./dist", pageId="abc")`
- **THEN** 上传时携带 pageId 字段，服务器更新现有页面

#### Scenario: 目录不存在
- **WHEN** 指定的 path 不存在或不是目录
- **THEN** 返回错误信息

#### Scenario: 环境变量未配置
- **WHEN** `LOCALAPP_SERVER_URL` 或 `LOCALAPP_API_KEY` 未设置
- **THEN** 返回错误信息

### Requirement: create_schema

MCP Tool `create_schema` SHALL 为页面创建数据 Schema 并返回 CRUD 端点信息。

#### Scenario: 成功创建
- **WHEN** 调用 `create_schema(pageId="abc", name="todos", fields={...})`
- **THEN** POST 到 `/api/schemas`，返回 schema 信息和 CRUD 端点 URL

#### Scenario: 返回 endpoints
- **WHEN** create_schema 成功
- **THEN** 响应包含 `endpoints: { list, create, get, update, delete }` 完整 URL

### Requirement: list_pages

MCP Tool `list_pages` SHALL 列出当前用户的所有页面。

#### Scenario: 成功列出
- **WHEN** 调用 `list_pages()`
- **THEN** GET `/api/pages`，返回页面列表

#### Scenario: 无页面
- **WHEN** 用户没有任何页面
- **THEN** 返回空列表

### Requirement: delete_page

MCP Tool `delete_page` SHALL 删除指定页面。

#### Scenario: 成功删除
- **WHEN** 调用 `delete_page(pageId="abc")`
- **THEN** DELETE `/api/pages/abc`，返回删除确认

#### Scenario: 页面不存在
- **WHEN** 删除不存在的 pageId
- **THEN** 返回错误信息

### Requirement: get_page_info

MCP Tool `get_page_info` SHALL 返回页面详情。

#### Scenario: 页面存在
- **WHEN** 调用 `get_page_info(pageId="abc")`
- **THEN** GET `/api/pages/abc`，返回页面详情（包含版本历史、schema 定义等）

#### Scenario: 页面不存在
- **WHEN** 查询不存在的 pageId
- **THEN** 返回错误信息

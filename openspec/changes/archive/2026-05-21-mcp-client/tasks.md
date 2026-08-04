## 1. 基础设施

- [x] 1.1 创建 `packages/mcp-client/src/api-client.ts`：封装 HTTP 请求（fetch wrapper、环境变量读取、错误处理）
- [x] 1.2 创建 `packages/mcp-client/src/tools.ts`：MCP Tool 注册

## 2. MCP Tool 实现

- [x] 2.1 实现 `upload_page` tool：递归读取目录、multipart 上传
- [x] 2.2 实现 `create_schema` tool：创建 schema + 获取 endpoints
- [x] 2.3 实现 `list_pages` tool
- [x] 2.4 实现 `delete_page` tool
- [x] 2.5 实现 `get_page_info` tool
- [x] 2.6 更新 `index.ts` 注册所有 tool

## 3. 测试

| Spec | Scenario | Status |
|------|----------|--------|
| mcp-tools | 成功上传 | ✓ |
| mcp-tools | 指定 pageId | ✓ |
| mcp-tools | 目录不存在 | ✓ |
| mcp-tools | 环境变量未配置 | ✓ |
| mcp-tools | 成功创建 schema | ✓ |
| mcp-tools | 返回 endpoints | ✓ |
| mcp-tools | 成功列出页面 | ✓ |
| mcp-tools | 无页面 | ✓ |
| mcp-tools | 成功删除 | ✓ |
| mcp-tools | 页面不存在 | ✓ |
| mcp-tools | 页面存在 | ✓ |
| mcp-tools | 页面不存在（get） | ✓ |

- [x] 3.1 编写 e2e 测试辅助：启动真实 HTTP server + 直接调用 tool 函数
- [x] 3.2 为 mcp-tools > Scenario: 成功上传 编写 e2e 测试
- [x] 3.3 为 mcp-tools > Scenario: 指定 pageId 编写 e2e 测试
- [x] 3.4 为 mcp-tools > Scenario: 目录不存在 编写 e2e 测试
- [x] 3.5 为 mcp-tools > Scenario: 环境变量未配置 编写 e2e 测试
- [x] 3.6 为 mcp-tools > Scenario: 成功创建 schema 编写 e2e 测试
- [x] 3.7 为 mcp-tools > Scenario: 返回 endpoints 编写 e2e 测试
- [x] 3.8 为 mcp-tools > Scenario: 成功列出页面 编写 e2e 测试
- [x] 3.9 为 mcp-tools > Scenario: 无页面 编写 e2e 测试
- [x] 3.10 为 mcp-tools > Scenario: 成功删除 编写 e2e 测试
- [x] 3.11 为 mcp-tools > Scenario: 页面不存在（delete） 编写 e2e 测试
- [x] 3.12 为 mcp-tools > Scenario: 页面存在（get） 编写 e2e 测试
- [x] 3.13 为 mcp-tools > Scenario: 页面不存在（get） 编写 e2e 测试
- [x] 3.14 运行全部 e2e 测试，确认通过

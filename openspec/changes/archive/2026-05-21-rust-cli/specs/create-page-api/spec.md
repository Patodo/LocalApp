## ADDED Requirements

### Requirement: POST /api/pages 创建空页面

服务端 SHALL 提供 `POST /api/pages` 端点（需认证），创建空页面并返回 pageId。

#### Scenario: 成功创建
- **WHEN** 发送 `POST /api/pages`（带有效 API Key）
- **THEN** 返回 `200`，`{ success: true, data: { pageId, url, createdAt } }`，服务端创建页面目录和 meta.json

#### Scenario: 未认证
- **WHEN** 发送 `POST /api/pages` 不带 API Key
- **THEN** 返回 `401`，`{ success: false, error: "Unauthorized" }`

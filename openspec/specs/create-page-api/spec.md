## Purpose

页面创建 API。提供 POST /api/pages 端点，支持认证用户通过 name 创建空页面，校验 name 格式和用户级唯一性。

## Requirements

### Requirement: POST /api/pages 创建空页面

服务端 SHALL 提供 `POST /api/pages` 端点（需认证），接收 name 作为必填参数，校验 name 格式和用户级唯一性，创建空页面并返回页面信息。

#### Scenario: 成功创建
- **WHEN** 发送 `POST /api/pages` 携带 `{ name: "my-cool-app" }`（带有效 API Key）
- **THEN** 返回 `200`，`{ success: true, data: { name, url: "/serve/{userId}/{name}", createdAt } }`，服务端创建页面目录 `data/{userId}/{name}/` 和 meta.json

#### Scenario: 未认证
- **WHEN** 发送 `POST /api/pages` 不带 API Key
- **THEN** 返回 `401`，`{ success: false, error: "Unauthorized" }`

#### Scenario: name 格式不合法
- **WHEN** 发送 `POST /api/pages` 携带 `{ name: "My_App" }`
- **THEN** 返回 `400`，`{ success: false, error: "Invalid name" }`

#### Scenario: name 使用保留词
- **WHEN** 发送 `POST /api/pages` 携带 `{ name: "api" }`
- **THEN** 返回 `400`，`{ success: false, error: "Invalid name" }`

#### Scenario: 同一用户下 name 重复
- **WHEN** 发送 `POST /api/pages` 携带 `{ name: "my-app" }`，但该用户已有同名页面
- **THEN** 返回 `409`，`{ success: false, error: "Page name already exists" }`

#### Scenario: 不同用户下 name 相同
- **WHEN** 用户 B 发送 `POST /api/pages` 携带 `{ name: "my-app" }`，用户 A 已有同名页面
- **THEN** 返回 `200`，创建成功（name 用户级唯一）

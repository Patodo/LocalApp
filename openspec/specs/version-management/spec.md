## Purpose

页面版本管理与页面 CRUD 接口。支持版本自动递增、版本数量上限（10 个）自动清理，以及页面列表、详情、删除接口。

## Requirements

### Requirement: 版本自动递增

每次上传 MUST 创建新的版本目录，版本号从 1 开始自动递增。

#### Scenario: 首次上传
- **WHEN** 新 pageId 首次上传
- **THEN** 创建 `versions/v1/`，meta.json 中 `currentVersion` 为 1

#### Scenario: 后续上传
- **WHEN** 已有 2 个版本的页面再次上传
- **THEN** 创建 `versions/v3/`，meta.json 中 `currentVersion` 更新为 3

### Requirement: 版本数量限制

每个页面 MUST 保留最多 10 个版本。超出时自动删除最旧的版本目录。

#### Scenario: 未达上限
- **WHEN** 页面有 8 个版本，上传第 9 个
- **THEN** 保留 v1-v8，创建 v9，不删除任何版本

#### Scenario: 达到上限后上传
- **WHEN** 页面已有 v1-v10 共 10 个版本，上传第 11 个
- **THEN** 创建 v11，删除 v1 目录，保留 v2-v11

### Requirement: meta.json 版本记录

meta.json MUST 包含完整的版本列表。

#### Scenario: 版本记录结构
- **WHEN** 上传新版本后读取 meta.json
- **THEN** `versions` 数组包含所有现有版本的元信息（version、createdAt、fileCount、totalSize）

### Requirement: 页面列表接口

`GET /api/pages` SHALL 返回当前用户的所有页面列表。

#### Scenario: 列出页面
- **WHEN** 发送 `GET /api/pages` 携带有效 API Key
- **THEN** 返回 `{ success: true, data: [{ pageId, currentVersion, createdAt, updatedAt }] }`

### Requirement: 页面详情接口

`GET /api/pages/:pageId` SHALL 返回指定页面的详细信息。

#### Scenario: 获取存在的页面详情
- **WHEN** 发送 `GET /api/pages/abc123` 携带有效 API Key，页面存在
- **THEN** 返回 `{ success: true, data: { pageId, userId, currentVersion, versionCount, versions: [...], createdAt, updatedAt } }`

#### Scenario: 获取不存在的页面详情
- **WHEN** 发送 `GET /api/pages/nonexistent` 携带有效 API Key
- **THEN** 返回 HTTP 404，`{ success: false, error: "Page not found" }`

### Requirement: 页面删除接口

`DELETE /api/pages/:pageId` SHALL 删除页面及其所有版本和数据。

#### Scenario: 删除存在的页面
- **WHEN** 发送 `DELETE /api/pages/abc123` 携带有效 API Key，页面属于该用户
- **THEN** 删除整个 `data/{userId}/abc123/` 目录（包括所有版本和 meta.json），返回 `{ success: true, data: { deleted: true, pageId: "abc123" } }`

#### Scenario: 删除他人的页面
- **WHEN** 发送 `DELETE /api/pages/abc123` 但页面属于其他用户
- **THEN** 返回 HTTP 403，`{ success: false, error: "Forbidden" }`

## ADDED Requirements

### Requirement: Multipart 文件上传

`POST /api/upload` SHALL 接收 multipart/form-data 请求，包含可选的 `pageId` 字段和多个文件 parts。

#### Scenario: 上传新页面（自动生成 pageId）
- **WHEN** 发送 multipart 请求包含 3 个文件，不携带 pageId 字段
- **THEN** 服务器生成 nanoid 作为 pageId，创建 `data/{userId}/{pageId}/versions/v1/`，写入所有文件，返回 `{ success: true, data: { pageId, url, version: 1 } }`

#### Scenario: 上传更新页面（指定 pageId）
- **WHEN** 发送 multipart 请求包含文件和 `pageId: "existing-page"`
- **THEN** 创建新版本目录 `v{N+1}/`，写入文件，更新 meta.json，返回 `{ success: true, data: { pageId, url, version: N+1 } }`

#### Scenario: 上传空文件列表
- **WHEN** 发送 multipart 请求不包含任何文件
- **THEN** 返回 HTTP 400，`{ success: false, error: "No files provided" }`

### Requirement: 上传大小限制

单次上传总大小 MUST 不超过 50MB。

#### Scenario: 超出大小限制
- **WHEN** 上传文件总大小超过 50MB
- **THEN** 返回 HTTP 413，`{ success: false, error: "Upload exceeds 50MB limit" }`

### Requirement: 单用户存储限制

单用户总存储 MUST 不超过 500MB。

#### Scenario: 超出用户存储限制
- **WHEN** 用户已有页面总存储接近 500MB，新上传将超出限制
- **THEN** 返回 HTTP 413，`{ success: false, error: "User storage limit exceeded" }`

### Requirement: 文件存储结构

上传的文件 MUST 按原始相对路径存储到版本目录中。

#### Scenario: 带子目录的文件
- **WHEN** 上传文件名为 `assets/images/logo.png`
- **THEN** 文件存储为 `data/{userId}/{pageId}/versions/v{N}/assets/images/logo.png`，自动创建中间目录

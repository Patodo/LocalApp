## MODIFIED Requirements

### Requirement: Multipart 文件上传

`POST /api/upload` SHALL 接收 multipart/form-data 请求，包含可选的 `pageId` 字段和多个文件 parts。每个文件 part 可附带一个 `filepath_{index}` text field 指定相对路径。服务端优先使用 `filepath` 字段，回退到 `part.filename`。

#### Scenario: 上传新页面（自动生成 pageId）
- **WHEN** 发送 multipart 请求包含 3 个文件，不携带 pageId 字段
- **THEN** 服务器生成 nanoid 作为 pageId，创建 `data/{userId}/{pageId}/versions/v1/`，写入所有文件，返回 `{ success: true, data: { pageId, url, version: 1 } }`

#### Scenario: 上传更新页面（指定 pageId）
- **WHEN** 发送 multipart 请求包含文件和 `pageId: "existing-page"`
- **THEN** 创建新版本目录 `v{N+1}/`，写入文件，更新 meta.json，返回 `{ success: true, data: { pageId, url, version: N+1 } }`

#### Scenario: 上传空文件列表
- **WHEN** 发送 multipart 请求不包含任何文件
- **THEN** 返回 HTTP 400，`{ success: false, error: "No files provided" }`

#### Scenario: 带 filepath 字段的子目录文件
- **WHEN** 发送 multipart 请求，文件 part 前附带 `filepath_0: "assets/style.css"` 字段
- **THEN** 文件存储为 `data/{userId}/{pageId}/versions/v{N}/assets/style.css`，`filepath` 优先于 `part.filename`

#### Scenario: 不带 filepath 字段时回退到 filename
- **WHEN** 发送 multipart 请求不带 `filepath` 字段，文件 part 的 filename 为 `style.css`
- **THEN** 文件存储为 `data/{userId}/{pageId}/versions/v{N}/style.css`（向后兼容）

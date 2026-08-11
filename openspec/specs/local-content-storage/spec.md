## Purpose

本地内容存储降级机制。当 MinIO 不可用时，内容上传和读取自动降级为本地文件系统存储，确保服务在无外部依赖时仍可正常运行。

## Requirements

### Requirement: MinIO 不可用时自动降级为本地存储

系统 SHALL 在启动时检测 MinIO 连接可用性。若 MinIO 不可达，内容上传和读取 SHALL 自动使用本地文件系统存储，API 响应格式不变。

#### Scenario: MinIO 不可达时上传文件到本地
- **WHEN** MinIO 连接失败（ECONNREFUSED 或超时），已认证应用通过 `POST /serve/{owner}/{pageName}/api/content/upload` 上传文件
- **THEN** 文件写入该 Server 的本地应用内容存储，返回 201 含 `{ key, url }` 格式与 S3 模式一致
- **AND** `url` SHALL 为 `/serve/{owner}/{pageName}/api/content/{key}`

#### Scenario: MinIO 可用时正常使用 S3
- **WHEN** MinIO 连接成功且应用访问 `/serve/{owner}/{pageName}/api/content/*`
- **THEN** 上传和读取通过 MinIO S3 API，行为与变更前一致

#### Scenario: 本地存储模式下读取文件
- **WHEN** 本地存储模式，请求 `GET /serve/{owner}/{pageName}/api/content/{key}`
- **THEN** 从本地文件系统读取并返回文件内容，Content-Type 根据扩展名设置

#### Scenario: 本地存储模式下读取不存在的文件
- **WHEN** 本地存储模式，请求 `GET /serve/{owner}/{pageName}/api/content/{key}`，文件不存在
- **THEN** 返回 404 `{ success: false, error: "File not found" }`

### Requirement: 内容存储支持标准文件类型

本地存储模式 SHALL 支持与 S3 模式相同的文件类型和大小限制，包括平台 capability 声明的图片格式与 PDF。

#### Scenario: 文件类型校验
- **WHEN** 上传 allowlist 之外的文件（如 .txt）
- **THEN** 返回 400 `{ success: false, error: "Unsupported file type" }`，与 S3 模式一致

#### Scenario: 文件大小校验
- **WHEN** 上传超过 10MB 的文件
- **THEN** 返回 413 `{ success: false, error: "File exceeds 10MB limit" }`，与 S3 模式一致

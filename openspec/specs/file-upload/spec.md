## Purpose

文件上传机制。通过 multipart/form-data 接收整个目录的文件上传，支持文件大小限制和用户存储配额。

## Requirements

### Requirement: Multipart 文件上传

`POST /api/upload` SHALL 接收 multipart/form-data 请求，包含 name 字段标识目标页面和多个文件 parts。每个文件 part 可附带一个 `filepath_{index}` text field 指定相对路径。

#### Scenario: 上传到指定页面（通过 name）
- **WHEN** 发送 multipart 请求包含 name 字段 `my-cool-app` 和文件
- **THEN** 将文件写入 `data/{userId}/{name}/`，更新 meta.json，返回 `{ success: true, data: { name, url, version } }`

#### Scenario: 上传空文件列表
- **WHEN** 发送 multipart 请求不包含任何文件
- **THEN** 返回 HTTP 400，`{ success: false, error: "No files provided" }`

#### Scenario: 页面不存在
- **WHEN** 发送 multipart 请求包含不存在的 name
- **THEN** 返回 HTTP 404，`{ success: false, error: "Page not found" }`

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

上传的文件 MUST 按原始相对路径存储到页面目录中。

#### Scenario: 带 filepath 字段的子目录文件
- **WHEN** 发送 multipart 请求，文件 part 前附带 `filepath_0: "assets/style.css"` 字段
- **THEN** 文件存储为 `data/{userId}/{name}/assets/style.css`，`filepath` 优先于 `part.filename`

#### Scenario: 不带 filepath 字段时回退到 filename
- **WHEN** 发送 multipart 请求不带 `filepath` 字段，文件 part 的 filename 为 `style.css`
- **THEN** 文件存储为 `data/{userId}/{name}/style.css`（向后兼容）

### Requirement: CLI upload 端到端验证

测试 SHALL 通过 CLI `upload` 命令验证文件上传完整链路。

#### Scenario: 上传包含子目录的项目
- **WHEN** 执行 `localapp upload ./dist`，`dist/` 包含 `index.html`、`assets/style.css`、`assets/app.js`
- **THEN** CLI 输出 `{ "name", "url", "version" }`，退出码 0；文件可通过 `/serve/` 路径访问

#### Scenario: 上传空目录
- **WHEN** 执行 `localapp upload ./empty-dir`，目录为空
- **THEN** CLI 输出错误 JSON 到 stderr，退出码 1

### Requirement: upload 接口接收并持久化 shell 配置
upload 路由 SHALL 接收 shell 配置并持久化到 meta.json。

#### Scenario: upload 请求包含 shellConfig 字段
- **WHEN** POST /api/upload 请求包含 `shellConfig` 字段（JSON string）
- **THEN** 服务端将 shellConfig 解析后保存到 meta.json 的 `shell` 字段

#### Scenario: upload 请求不包含 shellConfig
- **WHEN** POST /api/upload 请求不包含 `shellConfig` 字段
- **THEN** meta.json 的 `shell` 字段保持不变（不覆盖/不删除）

#### Scenario: CLI upload 读取 manifest.json 的 shell 配置
- **WHEN** 用户执行 `localapp upload`
- **THEN** CLI 读取 manifest.json 的 `shell` 字段（如果存在），作为 `shellConfig` 字段一起上传

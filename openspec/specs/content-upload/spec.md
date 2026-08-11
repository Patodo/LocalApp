## Purpose

定义 canonical Server 为每个应用提供隔离、可验证且可预览/下载的内容存储 API。

## Requirements

### Requirement: 应用内容上传使用应用作用域 API

应用 SHALL 通过 `POST /serve/<owner>/<app>/api/content/upload` 上传一个 multipart 文件。SDK 在正式 Shell 中 SHALL 从应用 resource base 推导该路径；Vite 开发页请求 `/api/content/upload` 时 SHALL 改写到当前项目 Server 上已安装应用的同一路由实现。旧的全局发布上传端点 SHALL NOT 作为应用内容 API。

#### Scenario: 正式应用上传文件

- **WHEN** 已认证用户在正式 `/<owner>/<app>/` 页面调用 `useUpload()`
- **THEN** SDK SHALL POST 到该应用的 `/serve/<owner>/<app>/api/content/upload`
- **AND** Server SHALL 返回 `{ success: true, data: { key, url } }`

#### Scenario: 开发应用上传文件

- **WHEN** `localapp dev` 页面调用 `useUpload()`
- **THEN** Vite SHALL 把 `/api/content/upload` 转发到项目 canonical Server 的应用作用域路由
- **AND** 响应格式、认证、限额和存储实现 SHALL 与正式安装一致

### Requirement: 内容类型、MIME 与签名一致校验

Server SHALL 按平台 capability allowlist 校验文件扩展名、声明 MIME、内容签名和大小。当前 SHALL 支持 PNG、JPEG、GIF、WebP、SVG 和 PDF；声明类型与内容不一致、类型不支持或超限 SHALL 在写入前拒绝。

#### Scenario: 上传合法图片

- **WHEN** 用户上传扩展名、MIME 和签名一致且未超限的 PNG
- **THEN** Server SHALL 写入应用命名空间并返回 201

#### Scenario: 上传合法 PDF

- **WHEN** 用户上传 `application/pdf` 且内容以有效 PDF signature 开始
- **THEN** Server SHALL 保存原始字节并返回可内联预览的 URL

#### Scenario: MIME 或签名不匹配

- **WHEN** 文件扩展名为图片但声明为 PDF，或文件字节不匹配声明类型
- **THEN** Server SHALL 返回稳定 400 错误 code
- **AND** SHALL NOT创建内容对象

#### Scenario: 文件过大

- **WHEN** 文件超过平台 capability 声明的上传上限
- **THEN** Server SHALL 返回 HTTP 413

### Requirement: 内容对象按 Server 和应用隔离

对象 key SHALL 存储在当前 Server 的 `<owner>/<app>` 命名空间中。不同 Server、所有者或应用使用相同 content key 时 SHALL 仍相互隔离。普通应用包安装和 app-only peer sync SHALL NOT 携带内容对象；只有显式 app-and-data 同步可在一致性快照中整体替换该应用文件。

#### Scenario: 跨应用读取被隔离

- **WHEN** 应用 B 使用应用 A 的 content key 请求自己的内容路由
- **THEN** Server SHALL 返回 404
- **AND** SHALL NOT泄露应用 A 的对象元数据

#### Scenario: 常规版本安装保留文件

- **WHEN** 同名应用安装新 `.localapp` 版本
- **THEN** 已上传内容 SHALL 保留
- **AND** 新版本 SHALL 继续使用同一应用文件命名空间

### Requirement: 内容读取支持安全预览和原始下载

`GET /serve/<owner>/<app>/api/content/<key>` SHALL 返回原始字节、正确 `Content-Type`、`X-Content-Type-Options: nosniff` 和安全 `Content-Disposition`。Server SHALL 支持单段 byte range，以便 PDF 预览和大文件读取；无效 range SHALL 返回 416。SVG SHALL 额外使用 sandbox CSP。

#### Scenario: 读取图片

- **WHEN** 浏览器读取已上传 PNG URL
- **THEN** Server SHALL 返回 `image/png` 与完全相同的原始字节
- **AND** 浏览器 MAY 内联显示

#### Scenario: PDF range 请求

- **WHEN** PDF 预览器发送合法单段 `Range` header
- **THEN** Server SHALL 返回 206、`Content-Range`、`Accept-Ranges: bytes` 和对应原始字节片段

#### Scenario: 下载原始文件

- **WHEN** 应用使用平台下载能力下载 content URL
- **THEN** 下载字节 SHALL 与上传 fixture 字节级一致

### Requirement: 内容存储提供者不改变 API 契约

Server MAY 使用本地文件系统或 S3-compatible provider 保存内容。provider、endpoint、bucket 和凭据 SHALL 由 Server 配置决定，不得写入应用包或暴露给应用页面。provider 不可用时 Server SHALL 返回明确存储错误或使用已配置的本地 fallback；不得把内容写入开发项目源码目录。

#### Scenario: 离线本地 Server

- **WHEN** Server 使用本地文件 provider 且无网络
- **THEN** 图片和 PDF 上传、读取与下载 SHALL 正常工作
- **AND** 对应用的响应契约 SHALL 与 S3 provider 一致

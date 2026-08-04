## Context

当前 CLI 上传文件时，reqwest 的 multipart 会将相对路径（如 `assets/style.css`）设为 `Content-Disposition: filename="assets/style.css"`。但 `@fastify/multipart` 底层的 busboy 库会按 RFC 6266 规范提取 basename，只保留 `style.css`。服务端 `part.filename` 拿不到完整路径。

服务端 upload.ts 已有创建中间目录的逻辑（`fs.mkdirSync(fileDir, { recursive: true })`），问题仅在于拿不到带目录的文件名。

## Goals / Non-Goals

**Goals:**
- CLI 上传子目录文件后，文件按原始相对路径存储
- 向后兼容：不破坏现有不带 `filepath` 的上传请求

**Non-Goals:**
- 不修改 multipart 协议或替换 busboy
- 不改变 API 接口

## Decisions

### 1. CLI 为每个文件额外发送 `filepath` 字段

每个文件 part 前插入一个名为 `filepath_{index}` 的 text field，值为相对路径。服务端优先使用此字段。

**替代方案**: 使用自定义 header — 但 multipart 中 header 是 per-part 的，`@fastify/multipart` 不暴露 part headers。不可行。

**替代方案**: 将路径编码到 filename 中（如 `assets__style.css`）— 脆弱且不规范。

### 2. 服务端按 part 顺序匹配 filepath

CLI 按顺序发送 `{filepath_0, file_0, filepath_1, file_1, ...}`。服务端用 Map 按 part 索引收集 filepath，然后与文件列表按顺序匹配。

**替代方案**: 使用 `filepath` 字段名与文件名匹配 — 但同名文件会冲突。

## Risks / Trade-offs

- **字段名约定**: `filepath_{index}` 是私有约定，第三方客户端不知道 → 保留 `part.filename` 作为回退，不影响直接调用 API 的用户
- **part 顺序依赖**: 依赖 multipart parts 的发送顺序 → HTTP multipart 规范中 parts 顺序是确定的（按 form 中出现的顺序），可行

## Why

CLI 上传子目录文件时（如 `dist/assets/style.css`），multipart 的 `filename` 属性会被 `@fastify/multipart`（底层 busboy）剥离目录前缀，只保留 basename（`style.css`）。导致文件存储丢失子目录结构，与 file-upload spec 中"按原始相对路径存储"的要求不符。

## What Changes

- CLI 端：每个文件 part 额外附带一个 `filepath` 字段，值为文件的相对路径（如 `assets/style.css`）
- Server 端：upload 路由优先读取 `filepath` 字段作为存储路径，回退到 `part.filename`
- 补充 e2e 测试验证 CLI 上传子目录文件后能通过 `/serve/` 正确访问

## Capabilities

### New Capabilities

（无）

### Modified Capabilities
- `file-upload`: 文件上传时服务端支持读取 `filepath` 字段保留子目录结构
- `cli-tool`: CLI upload 发送时附带 `filepath` 字段

## Impact

- `packages/server/src/routes/upload.ts`：读取 filepath 字段
- `packages/cli/src/client.rs`：multipart form 中添加 filepath 字段
- `packages/server/tests/e2e-cli/upload.test.ts`：补充子目录上传的 e2e 测试
- `packages/server/tests/e2e-cli/serve.test.ts`：补充子目录文件可通过 serve 访问的验证

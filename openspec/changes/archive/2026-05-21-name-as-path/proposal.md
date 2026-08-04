## Why

当前页面使用随机生成的 pageId（nanoid/hex）作为标识符和 URL 路径，导致 URL 不可读、不可记忆（如 `/{userId}/01755ac162c4133c`）。使用应用的 name 作为 URL slug（如 `/{userId}/my-cool-app`）可以让链接更有语义、更易于分享和识别，同时也简化了数据模型——name 既是展示名称也是唯一标识符。

## What Changes

- **BREAKING**: 移除 pageId 概念，应用 name 成为唯一标识符和 URL 路径组件
- **BREAKING**: URL 格式从 `/{userId}/{pageId}` 变为 `/{userId}/{name}`
- **BREAKING**: 存储路径从 `data/{userId}/{pageId}/` 变为 `data/{userId}/{name}/`
- 新增 name 验证规则：小写字母 + 数字 + 连字符，字母开头，3-63 字符，禁止连续连字符和首尾连字符
- 服务端在页面创建时校验 name 合法性和用户级唯一性
- CLI init 命令的 name 验证规则与服务端对齐
- CLI manifest.json 移除 pageId 字段，name 成为必需字段
- 所有 API 路由的 pageId 参数替换为 name

## Capabilities

### New Capabilities

- `name-validation`: 应用名称的合法性校验规则，包括格式约束（小写+数字+连字符、字母开头、3-63字符、无连续/首尾连字符）和保留词列表，CLI 和 Server 共用同一套规则

### Modified Capabilities

- `create-page-api`: 创建页面时接收 name 作为必填参数，替代自动生成的 pageId；服务端校验 name 格式和用户级唯一性
- `page-serving`: URL 路径从 `/{userId}/{pageId}` 变为 `/{userId}/{name}`
- `file-upload`: 上传时使用 name 替代 pageId 标识目标页面，移除 nanoid 自动生成逻辑
- `cli-tool`: init 命令 name 验证收紧为 kebab-case 规则；new 命令发送 name 而非接收 pageId；manifest.json 移除 pageId 字段
- `shared-types`: Page 模型移除 id/pageId，新增 name 作为标识符；相关 API 类型同步更新
- `schema-management`: 所有 schema 路由的 pageId 查询参数替换为 name
- `crud-api`: CRUD API 路径中的 pageId 替换为 name

## Impact

- **Server**: routes/pages.ts、routes/upload.ts、routes/serve.ts、routes/schemas.ts、routes/crud.ts、plugins/storage.ts 均需将 pageId 替换为 name
- **CLI**: commands/init.rs、commands/new_page.rs、commands/upload.rs、commands/pages.rs、commands/schemas.rs、project.rs 均需更新
- **Shared**: models.ts、api.ts 类型定义更新
- **API 兼容性**: 所有包含 pageId 的 API 端点均为 BREAKING 变更，但项目未发布，无向后兼容问题
- **存储结构**: 目录名从随机 ID 变为 name，已有开发数据需清理（data/ 目录）

## Why

LocalApp 的远程 HTTP 服务器目前只有一个健康检查端点。需要实现核心的页面托管功能：API Key 鉴权、文件上传、页面服务、版本管理。这是用户能实际使用平台的基础——上传前端项目并获得可访问链接。

## What Changes

- 实现 API Key 鉴权中间件，API Key 与 userId 映射存储在服务级 SQLite（`meta.sqlite`）
- 实现文件上传接口（`POST /api/upload`），接收 multipart/form-data，存储到文件系统
- 实现页面访问（`GET /{userId}/{pageId}`），通过 iframe sandbox 包装提供安全隔离
- 实现静态文件服务（`GET /serve/{userId}/{pageId}/{version}/*`），支持 SPA fallback
- 实现版本管理，保留最近 10 个版本，自动清理超出版本
- 实现页面管理接口：列出页面、删除页面、获取页面详情
- pageId 使用 nanoid 生成
- 数据目录通过 `DATA_DIR` 环境变量配置，默认 `./data`

## Capabilities

### New Capabilities

- `api-key-auth`: API Key 鉴权机制，基于服务级 SQLite 存储 key → userId 映射，保护管理类接口
- `file-upload`: 多文件上传与存储，接收 multipart/form-data，支持二进制文件，存储到版本化目录
- `page-serving`: 页面访问与静态文件服务，iframe sandbox 隔离、CSP 头、SPA fallback
- `version-management`: 页面版本管理，自动版本号递增、保留最近 10 版、超限清理

### Modified Capabilities

（无新增修改）

## Impact

- `packages/server/` 主要变更区域，从骨架扩展为完整的 HTTP 服务
- `packages/shared/src/api.ts` 可能需要调整 `UploadRequest` 类型（适配 multipart 而非 JSON body）
- 新增 `meta.sqlite` 服务级数据库文件
- 新增文件系统存储目录结构

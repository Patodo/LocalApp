## Why

当前 LocalApp 只支持开发者上传整个应用包（部署用途），终端用户无法在前端应用中上传图片等内容。这使得构建 Bug 上报、带附件的表单等需要图片上传的应用场景无法实现。需要引入用户内容上传能力，使用 MinIO（S3 兼容）作为对象存储后端。

## What Changes

- 新增用户内容上传 API：`POST /serve/{userId}/{name}/api/content/upload`，支持图片文件上传到 MinIO
- 新增内容读取 API：`GET /serve/{userId}/{name}/api/content/{key}`，从 MinIO 读取并返回图片
- 内容访问控制复用现有 pageAccess 机制，图片权限跟随所属应用
- docker-compose.yml 新增 MinIO 服务容器
- Server 新增 `@aws-sdk/client-s3` 依赖，通过 S3 兼容协议连接 MinIO
- Client SDK 新增 `useUpload()` hook，供前端应用直接调用
- Init-repo 模板更新，在 skills 中展示图片上传用法

## Capabilities

### New Capabilities
- `content-upload`: 用户内容上传能力，包括 MinIO 集成、内容上传/读取 API、访问控制复用、Client SDK hook

### Modified Capabilities
- `client-sdk`: 新增 useUpload hook，扩展 SDK 的文件上传能力
- `init-template`: 在 skills 中补充图片上传相关的开发指引

## Impact

- **Server**: 新增 content 路由、MinIO/S3 客户端、配置项（MinIO endpoint/credentials）
- **Client SDK**: 新增 useUpload hook 及相关类型
- **Init-repo**: 更新 skills 文档
- **docker-compose.yml**: 新增 MinIO 服务及 volume
- **依赖**: server 新增 `@aws-sdk/client-s3`
- **现有功能无破坏性变更**: 应用部署上传、CRUD API、页面访问均不受影响

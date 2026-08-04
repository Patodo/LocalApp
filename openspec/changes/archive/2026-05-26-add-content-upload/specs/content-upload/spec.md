## ADDED Requirements

### Requirement: MinIO 服务容器

docker-compose.yml SHALL 新增 MinIO 服务，暴露 API 端口 9000 和 Console 端口 9001，使用 named volume 持久化数据，配置默认的 access key 和 secret key。

#### Scenario: docker-compose 启动 MinIO
- **WHEN** 在项目根目录执行 `docker compose up -d`
- **THEN** MinIO 容器启动，API 端口 9000 和 Console 端口 9001 可访问

#### Scenario: MinIO 数据持久化
- **WHEN** MinIO 容器重启
- **THEN** 之前上传的文件仍然存在

### Requirement: Server S3 客户端初始化

Server 启动时 SHALL 使用 `@aws-sdk/client-s3` 创建 S3 客户端，连接配置从 `config.toml` 或环境变量读取（`MINIO_ENDPOINT`、`MINIO_ACCESS_KEY`、`MINIO_SECRET_KEY`、`MINIO_BUCKET`）。若指定的 bucket 不存在 SHALL 自动创建。

#### Scenario: 从配置文件初始化
- **WHEN** `config.toml` 包含 `[minio]` 配置节（endpoint、accessKey、secretKey、bucket）
- **THEN** Server 启动时创建 S3 客户端并连接到指定 MinIO

#### Scenario: 从环境变量初始化
- **WHEN** 设置环境变量 `MINIO_ENDPOINT=localhost:9000`、`MINIO_ACCESS_KEY`、`MINIO_SECRET_KEY`
- **THEN** Server 使用环境变量配置创建 S3 客户端

#### Scenario: 自动创建 bucket
- **WHEN** 配置的 bucket 名称不存在
- **THEN** Server 启动时自动创建该 bucket

### Requirement: 内容上传 API

`POST /serve/{userId}/{name}/api/content/upload` SHALL 接收 multipart/form-data 请求，包含单个图片文件。上传前 SHALL 执行 `checkPageAccess` 校验访问权限。文件存储到 MinIO 的 `{userId}/{name}/{contentKey}.{ext}` 路径，contentKey 使用 nanoid 生成。返回 `{ success: true, data: { key, url } }`。

#### Scenario: 成功上传图片
- **WHEN** 已登录用户 POST 图片文件到 `/serve/alice/my-app/api/content/upload`
- **AND** 该用户有页面访问权限
- **THEN** 文件存储到 MinIO，返回 `{ success: true, data: { key: "abc123.png", url: "/serve/alice/my-app/api/content/abc123.png" } }`

#### Scenario: 未携带文件
- **WHEN** POST 请求不包含文件 part
- **THEN** 返回 HTTP 400，`{ success: false, error: "No file provided" }`

#### Scenario: 文件类型不支持
- **WHEN** POST 文件类型为 `.bmp`
- **THEN** 返回 HTTP 400，`{ success: false, error: "Unsupported file type" }`

#### Scenario: 文件超出大小限制
- **WHEN** POST 图片文件大小超过 10MB
- **THEN** 返回 HTTP 413，`{ success: false, error: "File exceeds 10MB limit" }`

#### Scenario: 无访问权限
- **WHEN** 未登录用户 POST 到 pageAccess 为 "authenticated" 的页面
- **THEN** 返回 HTTP 401

#### Scenario: owner 权限检查
- **WHEN** 非 owner 用户 POST 到 pageAccess 为 "owner" 的页面
- **THEN** 返回 HTTP 403

### Requirement: 内容读取 API

`GET /serve/{userId}/{name}/api/content/{key}` SHALL 从 MinIO 读取指定文件并返回，Content-Type 根据文件扩展名设置。读取前 SHALL 执行 `checkPageAccess` 校验访问权限。

#### Scenario: 读取已上传的图片
- **WHEN** GET `/serve/alice/my-app/api/content/abc123.png`
- **AND** 请求者有页面访问权限
- **THEN** 返回图片二进制数据，Content-Type 为 `image/png`

#### Scenario: 文件不存在
- **WHEN** GET `/serve/alice/my-app/api/content/nonexistent.png`
- **THEN** 返回 HTTP 404

#### Scenario: 读取受保护页面的内容
- **WHEN** GET `/serve/alice/my-app/api/content/abc123.png`
- **AND** pageAccess 为 "authenticated"
- **AND** 请求未携带有效 session
- **THEN** 返回 HTTP 401

#### Scenario: 读取 public 页面的内容
- **WHEN** GET `/serve/alice/my-app/api/content/abc123.png`
- **AND** pageAccess 为 "public"
- **THEN** 正常返回图片，无需认证

### Requirement: 内容 API 路由注册

内容上传和读取路由 SHALL 注册在 serveRoutes 中（公开路由），与其他 `/serve/` 路由使用相同的中间件链（session 解析、visitorId 提取）。路径匹配 SHALL 在 CRUD API 路由之前检查 `content` 关键字。

#### Scenario: 路由匹配优先级
- **WHEN** 请求 `GET /serve/alice/my-app/api/content/abc123.png`
- **THEN** 命中内容读取路由（不匹配 CRUD 的 `{resource}/{id}` 模式）

#### Scenario: CRUD 路由不受影响
- **WHEN** 请求 `GET /serve/alice/my-app/api/todos`
- **THEN** 正常命中 CRUD 路由，不受内容路由影响

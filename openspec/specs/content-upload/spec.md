## Purpose

This spec describes the expected behavior, acceptance criteria, and integration boundaries for the content-upload capability in LocalApp.
## Requirements
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

`POST /api/upload` SHALL 改为接收 multipart bundle,包含:
- `manifest` — manifest.json 内容(文件 part,filename 为 `manifest.json`,content-type 为 `application/json`)
- `filepath_<index>` — 第 `<index>` 个 dist 文件的相对路径
- `files` — 前端构建产物文件 part;每个 part 与同 index 的 `filepath_<index>` 对应
- `migration_<filename>` — migration SQL 文件 part;`<filename>` 为 migration 文件名
- `migrationChecksum_<filename>` — 对应 migration 文件内容的 SHA256 hex 字符串字段;server SHALL 拒绝缺失或不匹配的 checksum

server 端 SHALL 在防御式原子流程中处理。`localapp db validate` 已经在上传前验证 migration 能应用到生产快照,因此正常情况下 server 端不应再出现 migration 意外;但 server 仍 SHALL 防御磁盘、进程、checksum、并发等运行时异常:
1. 验证 migration checksum(防止传输损坏)
2. 写入 dist 到临时版本目录 `versions/.staging-v(N+1)`;此时 current 指针不切换
3. 备份当前 app.db 到临时 backup 文件,确认可写后再进入事务
4. BEGIN TRANSACTION
5. 应用所有 pending migration(数字顺序)
6. 原子提交 DB 事务
7. DB commit 成功后,把 staging 目录 rename 为 `versions/v(N+1)` 并原子切换 current 指针
8. 任一步失败 → ROLLBACK(若事务已开启),删除 staging 目录,不切换 current 指针,app.db 保持旧状态

CLI 端 SHALL 在 upload 前强制 `localapp db validate` 通过(详见 db-validate-flow spec)。

#### Scenario: 完整 upload 流程
- **WHEN** 用户执行 `localapp upload`,本地有 dist + 2 个 pending migrations
- **THEN** CLI 先执行 validate(在线拉 prod snapshot 验证 migrations)
- **AND** validate 通过后,打包 bundle(dist + migrations + manifest + checksums)
- **AND** 上传到 server `/api/upload`
- **AND** server 备份 app.db → 应用 migrations → 部署 dist,事务 commit
- **AND** CLI 打印 "Upload complete. Version v<N+1> deployed."

#### Scenario: upload 失败时全回滚
- **WHEN** upload 过程中 migration SQL 应用失败
- **THEN** server ROLLBACK 事务
- **AND** app.db 内容不变
- **AND** staging dist 被清理或保持不可见,current 指针不切换
- **AND** server 返回错误详情
- **AND** CLI 打印 "Upload failed. Both database and dist rolled back."

#### Scenario: upload 不上传 dev seed
- **WHEN** 用户执行 `localapp upload`,项目包含 `db/seeds/dev.sql`
- **THEN** bundle 中不包含该 seed 文件
- **AND** server 永远不执行 dev seed

### Requirement: 内容读取 API

`GET /serve/<userId>/<pageName>/*` SHALL 继续提供静态文件服务,行为不变。版本管理(current 指针切换)在 upload 事务中原子完成,保证读取到的版本要么是旧版要么是新版,不存在中间状态。

#### Scenario: upload 后读取到新版本
- **WHEN** upload 成功提交事务后,用户立即访问 `/serve/<userId>/<pageName>/`
- **THEN** server 返回新版本(current 指针已切换)的 index.html
- **AND** 静态资源也是新版本

#### Scenario: upload 失败后读取到旧版本
- **WHEN** upload 失败回滚后,用户访问 `/serve/<userId>/<pageName>/`
- **THEN** server 返回旧版本(current 指针未切换)
- **AND** 行为与 upload 前完全一致

### Requirement: 内容 API 路由注册

内容上传和读取路由 SHALL 注册在 serveRoutes 中（公开路由），与其他 `/serve/` 路由使用相同的中间件链（session 解析、visitorId 提取）。路径匹配 SHALL 在 CRUD API 路由之前检查 `content` 关键字。

#### Scenario: 路由匹配优先级
- **WHEN** 请求 `GET /serve/alice/my-app/api/content/abc123.png`
- **THEN** 命中内容读取路由（不匹配 CRUD 的 `{resource}/{id}` 模式）

#### Scenario: CRUD 路由不受影响
- **WHEN** 请求 `GET /serve/alice/my-app/api/todos`
- **THEN** 正常命中 CRUD 路由，不受内容路由影响

### Requirement: upload 备份策略(保留前两版本)

server SHALL 在每次有 pending migration 的 upload 时,执行 backup 升级流程:
1. 若 `app.db.backup.v2` 存在,删除
2. 若 `app.db.backup.v1` 存在,重命名为 `app.db.backup.v2`
3. 复制当前 `app.db` 到 `app.db.backup.v1`

backup 文件 SHALL 与 app.db 在同一目录,命名固定。

#### Scenario: 首次 backup
- **WHEN** 应用第一次有 pending migration 的 upload,目录无 backup 文件
- **THEN** server 复制 app.db → app.db.backup.v1
- **AND** 应用 migrations + 部署 dist

#### Scenario: 第二次 backup
- **WHEN** 应用第二次有 pending migration 的 upload,app.db.backup.v1 已存在
- **THEN** server 把 app.db.backup.v1 重命名为 app.db.backup.v2
- **AND** 复制当前 app.db → app.db.backup.v1
- **AND** 应用 migrations + 部署 dist

#### Scenario: 第三次 backup 自动淘汰旧版本
- **WHEN** 应用第三次有 pending migration 的 upload,v1 和 v2 都存在
- **THEN** server 删除 v2
- **AND** v1 → v2(重命名)
- **AND** 复制 app.db → v1
- **AND** 应用 migrations + 部署 dist

#### Scenario: upload 无 pending migration 不触发 backup
- **WHEN** upload bundle 不含新 migration(或所有 migration 已应用)
- **THEN** server 跳过 backup 步骤
- **AND** 只部署 dist(事务内)
- **AND** backup 文件不变

### Requirement: 应用内容 API 在 dev/prod 路径一致

应用侧文件上传 SHALL 使用 `{basePath}/content/upload`，文件读取 SHALL 使用上传结果中的 `url`。生产 serve 与 mini-server SHALL 均支持该路径。旧的 mini-server `/api/upload` MAY 作为兼容别名保留，但文档和 SDK SHALL 推荐内容 API 路径。

#### Scenario: dev 上传路径与 SDK 一致
- **WHEN** dev 应用通过 SDK 上传文件
- **THEN** 请求路径 SHALL 为 `/api/content/upload`
- **AND** mini-server SHALL 返回 `{ success: true, data: { key, url } }`

#### Scenario: prod 上传路径与 SDK 一致
- **WHEN** 生产应用通过 SDK 上传文件
- **THEN** 请求路径 SHALL 为 `/serve/{userId}/{pageName}/api/content/upload`
- **AND** 生产 serve SHALL 返回 `{ success: true, data: { key, url } }`

#### Scenario: 上传结果可直接展示
- **WHEN** 应用将上传结果的 `url` 用作图片或下载链接
- **THEN** dev 和 prod SHALL 都能通过该 URL 读取文件

### Requirement: 上传产物可被 native shell 挂载
上传的前端产物 SHALL 包含 native shell 可解析的 Vite 标准资源引用。服务端 SHALL 能从最新版本产物中定位应用入口 JS 和 CSS。

#### Scenario: 上传 Vite dist 后 native 可加载
- **WHEN** 用户上传包含 `index.html` 和 `assets/*` 的 Vite dist
- **THEN** 服务端 SHALL 保存完整版本产物
- **AND** native shell SHALL 能加载该版本入口资源

### Requirement: 上传成功后 native 入口立即使用最新版本
上传新版本成功后，native shell SHALL 立即使用新版本资源和 backend contract。

#### Scenario: 上传后访问最新应用
- **WHEN** 用户上传 vN 后立即访问生产页面
- **THEN** 页面 SHALL 加载 vN 的应用资源
- **AND** Named SQL SHALL 使用 vN 对应 backend contract 和已迁移的 app.db schema


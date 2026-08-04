## ADDED Requirements

### Requirement: localapp dev 启动本地 mini-server

`localapp dev` 命令 SHALL 在启动 vite dev server 之前,先 spawn 一个 Node.js 子进程运行 `runtime/mini-server.mjs`。mini-server 提供应用层 API(`/api/<resource>`、`/api/_schemas`、`/api/me`、`/api/upload`),数据写入 `.localapp/dev.db`。

mini-server SHALL 由 server-core 提供核心逻辑(schema、CRUD、权限),行为与生产 server 一致。LLM 请求(`/api/llm/*`)SHALL NOT 由 mini-server 处理,继续走生产 server。平台公共数据请求(`/api/platform/*`)SHALL 由 mini-server 转发到生产 server,并提供 5 分钟 TTL 缓存。

mini-server 端口 SHALL 随机分配(避免与 vite 或其他进程冲突),写入 `dev-config.json` 的 `miniServerPort` 字段。vite-plugin 读取该字段配置 proxy target。

#### Scenario: localapp dev 启动 mini-server 和 vite 两个进程
- **WHEN** 用户执行 `localapp dev`
- **THEN** CLI 先 spawn Node 子进程运行 `runtime/mini-server.mjs`,分配随机端口
- **AND** mini-server 启动后,把端口号写入 `.localapp/dev-config.json` 的 `miniServerPort` 字段
- **AND** CLI 随后 spawn `npm run dev`(vite),vite-plugin 读 `miniServerPort` 配置 proxy
- **AND** 终端打印 mini-server 和 vite 的状态行

#### Scenario: mini-server 应用未应用的 migrations
- **WHEN** mini-server 启动,检测到 `.localapp/dev.db` 存在
- **AND** 项目 `migrations/` 目录有未被 dev.db 应用的 migration 文件
- **THEN** mini-server 在启动时按文件名数字顺序应用 pending migrations
- **AND** 应用记录写入 dev.db 的 `_localapp_applied_migrations` 表

#### Scenario: dev.db 不存在时创建并应用所有 migrations
- **WHEN** mini-server 启动,检测到 `.localapp/dev.db` 不存在
- **THEN** mini-server 创建空 dev.db,应用 `migrations/` 目录下所有 migration 文件
- **AND** 如果存在 `db/seeds/dev.sql`,在所有 migration 应用后执行 seed

#### Scenario: 应用层 API 走本地 mini-server
- **WHEN** 浏览器请求 `/api/tasks`(或任何非 `/api/llm/*`、非 `/api/platform/*` 的 API)
- **THEN** vite-plugin 转发到 mini-server(localhost:<miniServerPort>)
- **AND** mini-server 从 dev.db 读/写数据,返回响应

#### Scenario: LLM 走生产 server,平台数据走 mini-server 缓存
- **WHEN** 浏览器请求 `/api/llm/chat`
- **THEN** vite-plugin 转发到生产 server(dev-config.json 的 `serverUrl`)
- **AND** mini-server 不参与该请求
- **WHEN** 浏览器请求 `/api/platform/users`
- **THEN** vite-plugin 转发到 mini-server(localhost:<miniServerPort>)
- **AND** mini-server 转发到生产 server,返回并缓存结果 5 分钟

#### Scenario: mini-server 随机端口避免冲突
- **WHEN** mini-server 启动
- **THEN** 在 5174-5200 范围内尝试寻找空闲端口
- **AND** 找到空闲端口后写入 dev-config.json
- **AND** 如果范围内所有端口都被占用,打印错误并退出

#### Scenario: dev 进程退出时 mini-server 也退出
- **WHEN** 用户按 Ctrl+C 或localapp dev 进程被 kill
- **THEN** mini-server 子进程也立即退出
- **AND** dev.db 文件保持完整(无 corruption)

### Requirement: mini-server 实现 mock /api/me

mini-server SHALL 实现 `GET /api/me` 端点,返回固定的 mock 开发用户:

```json
{
  "success": true,
  "data": {
    "id": "dev-user",
    "name": "Dev User",
    "displayName": "开发者",
    "role": "owner"
  }
}
```

dev 模式下所有数据的 `created_by` 字段 SHALL 为 `"dev-user"`。

#### Scenario: dev 模式 useMe 返回 mock 用户
- **WHEN** 应用通过 `useMe` hook 在 dev 模式下查询当前用户
- **THEN** mini-server 返回 `{ id: "dev-user", name: "Dev User", role: "owner" }`
- **AND** 不需要 API key 鉴权(dev 模式)

#### Scenario: 应用层 created_by 自动填充为 dev-user
- **WHEN** 应用通过 useCreate 创建记录,字段含 `defaultFrom: "currentUser.id"`
- **THEN** mini-server 把 `created_by` 字段填充为 `"dev-user"`
- **AND** 与生产模式行为一致(只是 userId 不同)

### Requirement: mini-server 实现本地 /api/upload

mini-server SHALL 实现 `POST /api/upload` 端点,把上传的文件存储到 `.localapp/dev-uploads/`,返回 `{ key, url }`。url 指向 mini-server 自己的端点 `/dev-uploads/<key>`。

#### Scenario: dev 模式文件上传到本地
- **WHEN** 应用通过 `useUpload` hook 上传图片
- **THEN** mini-server 接收文件,保存到 `.localapp/dev-uploads/<key>`
- **AND** 返回 `{ key: "<uuid>.<ext>", url: "/dev-uploads/<uuid>.<ext>" }`
- **AND** 应用可以通过该 url 访问文件(由 mini-server 提供)

#### Scenario: dev-uploads 目录自动创建
- **WHEN** 第一次上传文件
- **THEN** mini-server 自动创建 `.localapp/dev-uploads/` 目录(如果不存在)

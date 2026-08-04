## MODIFIED Requirements

### Requirement: 模板目录结构

`init-repo/` SHALL 在原结构基础上新增 `migrations/` 目录和 `db/seeds/` 目录,作为应用层 SQL migration 和 dev seed 的标准位置。模板 SHALL 包含一个初始 migration 文件 `migrations/001_init.sql` 作为示例。

```
init-repo/
├── migrations/                          ← 新增
│   └── 001_init.sql                     ← 示例初始 migration
├── db/
│   └── seeds/
│       └── dev.sql                      ← 示例 dev seed(可选)
├── src/
│   ├── App.tsx
│   ├── main.tsx
│   ├── index.css
│   └── components/ui/
├── runtime/
│   ├── vite-plugin.mjs
│   ├── dev-shell.tsx
│   ├── mini-server.mjs                  ← 新增
│   └── ...
├── manifest.json                        ← 新增 platformVersion 字段
└── ...
```

#### Scenario: 模板包含 migrations 目录
- **WHEN** 执行 `localapp init my-app` 后查看目录
- **THEN** 项目包含 `migrations/` 目录
- **AND** 目录内含 `001_init.sql` 文件(模板预置)

#### Scenario: 模板包含 db/seeds 目录
- **WHEN** 查看模板目录
- **THEN** 包含 `db/seeds/dev.sql` 文件
- **AND** 文件含示例 INSERT 语句(被注释或为少量测试数据)

#### Scenario: runtime 包含 mini-server.mjs
- **WHEN** 查看 `runtime/` 目录
- **THEN** 包含 `mini-server.mjs` 文件
- **AND` mini-server.mjs` 通过 `localapp dev` spawn 启动

#### Scenario: manifest.json 包含 platformVersion
- **WHEN** 查看模板的 manifest.json
- **THEN** 文件含 `"platformVersion": "^1.0"` 字段
- **AND` business` 块为空对象或示例业务规则

## ADDED Requirements

### Requirement: 模板预置示例 migration 文件

模板 SHALL 在 `migrations/001_init.sql` 提供示例 SQL,展示如何创建应用初始表。示例 SHALL 包含至少一个 CREATE TABLE 语句和索引。

示例 migration 文件内容(参考):

```sql
-- migrations/001_init.sql
-- 应用初始 schema,根据业务需要修改

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'todo',
  created_by TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
```

#### Scenario: 示例 migration 可执行
- **WHEN** 用户 `localapp init my-app` 后执行 `localapp db migrate`
- **THEN** 示例 001_init.sql 成功应用到 dev.db
- **AND` tasks` 表存在,有相应字段
- **AND` idx_tasks_status` 索引存在

#### Scenario: 示例 seed 文件可选应用
- **WHEN** 用户编辑 `db/seeds/dev.sql` 加入测试数据
- **AND` localapp db reset`
- **THEN` dev.db` 包含 seed 数据
- **AND` tasks` 表有示例记录

### Requirement: 模板 mini-server.mjs 实现

模板 `runtime/mini-server.mjs` SHALL 实现 mini-server 入口,接受命令行参数 `--port <N> --data-dir <path> --prod-server <url> --api-key <key>`,启动 HTTP server 提供应用层 API。

mini-server SHALL:
1. 加载 `.localapp/dev.db`(不存在则创建)
2. 应用 migrations 目录所有未应用的 migration
3. 监听端口,处理 `/api/<resource>`、`/api/_schemas`、`/api/me`、`/api/upload` 请求
4. 转发 `/api/platform/*` 到生产 server(带 5 分钟 TTL 缓存)
5. 接收 SIGTERM/SIGINT 信号优雅退出

#### Scenario: mini-server 启动
- **WHEN** localapp dev 命令 spawn `node runtime/mini-server.mjs --port 5174 ...`
- **THEN` mini-server.mjs` 启动成功,监听指定端口
- **AND` migrations/` 目录所有未应用 migration 已应用到 dev.db
- **AND` stdout` 打印 "Mini-server ready on port 5174"

#### Scenario: mini-server 转发平台请求
- **WHEN` mini-server` 收到 `/api/platform/users` 请求
- **THEN` mini-server` 转发到 `--prod-server` 指定的 URL
- **AND` X-API-Key` header 设为 `--api-key` 参数值
- **AND` 缓存 5 分钟

#### Scenario: mini-server 优雅退出
- **WHEN` mini-server` 收到 SIGTERM 或 SIGINT
- **THEN` mini-server` 关闭 HTTP server,等待 in-flight 请求完成
- **AND` dev.db` flush 到磁盘
- **AND` 进程退出码 0

### Requirement: 模板示例 main.tsx 不引用 mini-server

模板的 `src/main.tsx` SHALL 保持现状(只 render App),不引用 mini-server。mini-server 由 CLI 在 `localapp dev` 时 spawn 启动,对应用代码透明。

#### Scenario: main.tsx 不感知 mini-server
- **WHEN** 查看模板的 `src/main.tsx`
- **THEN** 文件只包含 `render(<App />)`,无 mini-server 相关引用
- **AND** DevShell 由 vite-plugin 虚拟模块注入(详见 dev-shell-injection spec)

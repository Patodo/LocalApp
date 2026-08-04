## Context

LocalApp 的每个页面项目拥有独立的 SQLite 数据库（`data/{userId}/{page}/db.sqlite`），当前通过 `crud-db.ts` 提供 RESTful CRUD 操作。底层使用 sql.js（SQLite 编译为 WASM），每次请求走完整周期：从磁盘加载 → WASM 操作 → 序列化写回 → 关闭。Server 本质是一个哑代理层。

现有权限系统已有两层控制：
- **PageAccess**: 页面级，控制谁能访问页面
- **RouteAccess** (per schema): 控制 read/create/update/delete 各自的访问级别

基础是 `visitorId`（JWT cookie）和 `userId`（API Key），owner 无条件放行。

CLI 已有 `manifest.json`（项目根目录），包含 `{ name, description, distDir }`，是纯本地配置，不上传。服务端有 `meta.json`（`data/{uid}/{page}/meta.json`），包含页面元数据。

## Goals / Non-Goals

**Goals:**
- 扩展本地 manifest.json 增加 `db` 配置，通过上传流程同步到服务端 meta.json
- 提供 `POST /api/db/exec` 端点执行任意 SQL，受权限管控
- crud-db.ts 改为长连接地图模式，消除每次 load/save/close 开销
- meta.json 中的 `db.defaultAccess` 作为 RouteAccess 的 fallback
- SDK 新增 raw SQL 执行方法

**Non-Goals:**
- 不做 SQLite 同步到浏览器本地（离线方案）
- 不改变现有 CRUD 端点的 URL 和语义
- 不改变 meta-sqlite.ts（已是单例长连接）
- 不做表级或行级数据权限（那是另外一个需求）
- 不做 SQL 执行超时或查询限制（后续迭代考虑）
- 不支持多语句 SQL（sql.js 使用 params 数组时不能执行分号分隔的多语句）

## Decisions

### 1. manifest.json — 单一配置源，同步到 meta.json

```
本地 manifest.json（项目根目录，CLI 已有，扩展 db 字段）:
{
  "name": "my-app",
  "description": "",
  "distDir": "dist",
  "db": {
    "mode": "crud",           // "crud" | "sql"
    "sqlAccess": "owner",     // 仅在 mode=sql 时生效
    "defaultAccess": {        // RouteAccess 的 fallback
      "read": "public",
      "create": "authenticated",
      "update": "authenticated",
      "delete": "owner"
    }
  }
}
```

**同步机制**: CLI 上传时（`localapp upload`）读取 manifest.json 的 `db` 字段，作为 multipart form field `dbConfig` 发送到 `/api/upload`。服务端 upload handler 将 `dbConfig` 存入 meta.json 的 `db` 字段。

**选择理由**: 一个 manifest.json = 一个配置源。不需要在服务端新建文件，利用已有的 meta.json 存储和读取机制。

**备选方案**: 在 `data/{uid}/{page}/` 下新建服务端 manifest.json —— 两个同名文件概念混淆，且需要新建读写机制。不选。

**改动点**:
- Rust Manifest struct 新增 `db` 字段
- `upload` 命令发送 `dbConfig` form field
- 服务端 `upload.ts` 解析并存储到 meta.json
- 服务端 `storage.ts` 的 PageMeta 新增 `db` 字段
- 服务端读 manifest 配置时从 meta.json 读取，无需单独的 manifest.ts 读文件

### 2. Raw SQL 端点设计

```
POST /serve/{userId}/{pageName}/api/db/exec

Request body:
{
  "sql": "SELECT * FROM todos WHERE status = ?",
  "params": ["done"]          // 可选，参数化查询
}

Response (SELECT):
{
  "success": true,
  "data": {
    "columns": ["id", "title", "status"],
    "rows": [{"id": 1, "title": "...", "status": "done"}]
  }
}

Response (INSERT/UPDATE/DELETE/DDL):
{
  "success": true,
  "data": {
    "changes": 1,
    "lastInsertRowId": 42
  }
}
```

**端点路径**: `/serve/{userId}/{pageName}/api/db/exec`，复用现有 `app.ALL("/serve/:userId/:name/*")` 路由。

**路由解析**: 在 `handleCrudRequest` 开头增加特殊分支，`parts[0] === "db" && parts[1] === "exec"` 时走 raw SQL 处理，不进入 CRUD 分发逻辑。避免被当作 `api/{resource}/{id}` 解析导致 `parseInt("exec")` → NaN → 400。

**SQL 执行**: 使用 sql.js 原生 API：
- 读操作: `db.exec(sql, params)` 返回 `QueryExecResult[]`（含 columns + values）
- 写操作: `db.run(sql, params)` 返回受影响行数

**参数化查询**: 前端传 params 数组，sql.js 原生绑定 `?` 占位符。params 缺省时传 `undefined`（sql.js 不做绑定）。

**限制**: 使用 params 数组时不支持多语句 SQL（sql.js 限制）。单语句可覆盖绝大多数场景。

### 3. 连接池设计

```
// crud-db.ts

const _connections = new Map<string, {
  db: SqlJsDatabase;
  lastUsed: number;
  dirty: boolean;
}>();

const IDLE_TIMEOUT_MS = 5 * 60 * 1000;  // 5 分钟

function getConnection(dbPath: string): SqlJsDatabase {
  // 命中缓存 → 更新 lastUsed，返回
  // 未命中 → loadDb(dbPath)，存入 Map，返回
}

function markDirty(dbPath: string): void {
  // 标记对应连接有未持久化写操作
}

function saveConnection(dbPath: string): void {
  // 导出 WASM 数据，写磁盘，清除 dirty 标记
}

function closeIdleConnections(): void {
  // 遍历 Map，关闭超过 IDLE_TIMEOUT_MS 的 clean 连接
  // 有 dirty 标记的连接先 save 再关闭
}

function closeAllConnections(): void {
  // 所有 dirty 连接先 save，再 close
  // 在服务关闭时调用
}
```

**嵌套调用处理**: `insertRow` 内部调用 `countRows`、`updateRow` 内部调用 `selectById` 等嵌套场景，改为统一使用 `getConnection(dbPath)`。由于 Map 缓存，嵌套调用会命中同一实例，不再各自独立 loadDb/close。

具体改动：
- `countRows`、`selectById` 等被嵌套调用的函数不再自行 loadDb/close，改用 `getConnection()`
- `insertRow`、`updateRow` 等写操作函数用 `getConnection()` + `markDirty()` + `saveConnection()` 替代 `loadDb → saveDb → close`
- 不再需要每函数末尾的 `db.close()`

**写操作后立即 save**: 数据安全优先。读操作不需要 save。空闲 5 分钟后关闭连接释放内存。

### 4. 权限判定流程

```
请求: /serve/{userId}/{pageName}/api/db/exec
      携带: Cookie (visitorId), Body ({ sql, params })

1. 读 meta.json 的 db 字段
   → db 未配置或 db.mode !== "sql" → 404（端点不存在）
   → db.mode === "sql" → 继续

2. 检查 db.sqlAccess
   → checkAccess(db.sqlAccess, visitorId, ownerId)
   → 不通过 → 403 / 401

3. 执行 SQL
   → getConnection(dbPath)
   → db.exec(sql, params) 或 db.run(sql, params)
   → 写操作: markDirty + saveConnection

对于现有 CRUD 端点（GET/POST/PUT/DELETE /api/{resource}）:

1. schema.routeAccess 有设定 → 用 schema 的
2. schema.routeAccess 无设定 → fallback 到 meta.db.defaultAccess
3. meta.db 也无 defaultAccess → fallback 到 "public"
```

### 5. 默认行为

meta.json 中无 `db` 字段的已有项目:
- `mode` 默认 `"crud"` → raw SQL 端点不可用
- `defaultAccess` 默认全 `"public"` → 行为不变

## Risks / Trade-offs

- **并发写冲突**: sql.js 是单文件、无服务进程的 SQLite。多个请求同时对同一个 db.sqlite 写操作时，WASM 实例间不共享锁。→ 连接池用单实例 per dbPath，天然的串行化。
- **内存占用**: 同时打开多个项目的数据库会占用内存。→ 空闲 5 分钟自动关闭，单用户场景通常只有 1-2 个活跃项目。
- **进程崩溃丢数据**: 写操作在 save 之前崩溃会丢失未持久化的数据。→ 每次写操作后立即 save，窗口极小。
- **DDL 与 schema 系统冲突**: 用户可通过 raw SQL 直接建表/删表，绕过 `/api/schemas` 的元数据管理。→ 这是 "完全放开" 的自然后果。raw SQL 模式下用户自行负责一致性；schema 端点仍然可用，但对 raw SQL 创建的表无感知。
- **多语句 SQL 限制**: sql.js 使用 params 数组时不能执行分号分隔的多语句。→ 前端需要拆分为多次单语句调用。后续可考虑提供 batch 端点。

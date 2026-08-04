## Context

server-crud 在 server-core 基础上构建数据层。server-core 已实现页面托管和鉴权，但前端应用需要数据存储。本变更为每个页面提供独立的 SQLite 数据库和 RESTful CRUD API。

当前状态：server-core 已合入 main，包含鉴权、上传、服务、版本管理。存储使用 sql.js（WASM SQLite），每个页面有 meta.json。PageMeta 接口定义在 `packages/server/src/plugins/storage.ts` 中。

## Goals / Non-Goals

**Goals:**

- Schema 管理接口（创建、增量更新、删除）
- 完整的 CRUD API（列表+分页+过滤+排序、单条、新增、修改、删除、计数）
- timestamp 字段自动填充
- 单表 10000 行限制

**Non-Goals:**

- 不实现关系型查询（JOIN、外键）
- 不实现聚合查询（SUM、AVG、GROUP BY）
- 不实现 WebSocket/实时数据推送
- 不实现数据导入导出
- 不实现事务支持

## Decisions

### 1. Schema 存储在 meta.json

Schema 定义作为 `schemas` 数组存储在页面的 meta.json 中，与页面元信息在一起。

理由：
- 读写 schema 不需要打开 SQLite 数据库
- 与已有的 meta.json 管理模式一致
- 删除页面时 schema 信息随 meta.json 一起清理

meta.json 扩展：
```json
{
  "pageId": "...",
  "schemas": [
    {
      "name": "todos",
      "fields": { "title": { "type": "string", "constraints": { "required": true } } },
      "createdAt": "...",
      "updatedAt": "..."
    }
  ]
}
```

### 2. CRUD 路由注册在公开作用域

CRUD API 不需要 API Key 鉴权，注册在 auth 插件作用域之外。只校验 pageId 对应的页面和 schema 存在。

### 3. 字段类型到 SQLite 的映射

| FieldType | SQLite 类型 | 备注 |
|-----------|-------------|------|
| string | TEXT | |
| number | REAL | |
| boolean | INTEGER | 0/1 |
| timestamp | TEXT | ISO 8601，服务器自动填充 |
| auto_increment | INTEGER PRIMARY KEY AUTOINCREMENT | 自动生成 ID |

每张表隐含 `id` 列（INTEGER PRIMARY KEY AUTOINCREMENT）和 `created_at`、`updated_at` 列（TEXT）。

### 4. Schema 更新策略（增量 ADD COLUMN）

`update_schema` 接收完整的 fields 定义，服务器 diff 后只执行 ALTER TABLE ADD COLUMN。不删除、不修改已有字段。需要大改时用户先 delete_schema 再 create_schema。

### 5. 查询参数设计

```
GET /api/{uid}/{pid}/{res}?offset=0&limit=20&sort=created_at&order=desc&field=value
```

- `offset` / `limit`：分页，默认 offset=0, limit=50
- `sort`：排序字段，默认 `id`
- `order`：`asc` 或 `desc`，默认 `asc`
- 其他参数作为等值过滤条件（`field=value`）

### 6. 代码组织

```
packages/server/src/
  lib/
    crud-db.ts          ← 页面级 SQLite CRUD 操作封装
  routes/
    schemas.ts          ← Schema 管理接口
    crud.ts             ← CRUD 数据接口
```

`crud-db.ts` 封装 sql.js 的初始化、建表、CRUD 操作，对外暴露高级 API。路由文件只处理 HTTP 请求/响应。

## Risks / Trade-offs

- **[SQL 注入风险]** → 表名和字段名通过白名单校验（必须匹配 schema 定义），值使用参数化查询。资源名称仅允许 `[a-zA-Z0-9_]`。
- **[Schema 更新与并发]** → meta.json 写入与 server-core 共享同一文件。内部工具并发量低，同步写入足够。
- **[sql.js 内存模型]** → 每次操作需从文件加载 db.sqlite，操作后导出保存。对于轻量 CRUD 场景可接受。后续可考虑连接池或缓存。
- **[10000 行限制]** → 在 INSERT 时检查行数，超出返回 403。单表数据量小，COUNT(*) 性能无问题。

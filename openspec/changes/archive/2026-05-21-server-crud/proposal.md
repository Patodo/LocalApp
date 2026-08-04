## Why

server-core 实现了页面托管的核心功能（鉴权、上传、服务、版本管理），但前端应用还需要数据存储能力。用户目前只能上传静态页面，无法进行数据的增删改查。server-crud 为每个页面提供内置的 Schema 定义和 RESTful CRUD API，让前端应用无需自建后端即可实现完整的数据交互。

## What Changes

- 实现 Schema 管理接口：创建、更新（增量 ADD COLUMN）、删除 schema
- Schema 定义存储在 meta.json 中（PageMeta 新增 schemas 字段）
- 每个页面独立的 db.sqlite（sql.js）存储 CRUD 数据
- 实现 RESTful CRUD API：列表（分页+过滤+排序）、单条查询、新增、修改、删除、计数
- timestamp 类型字段自动填充当前时间
- 单表最大 10000 行限制
- CRUD API 公开访问（不需要 API Key），仅校验 pageId 存在

## Capabilities

### New Capabilities

- `schema-management`: Schema 定义的生命周期管理，包含创建、增量更新、删除，schema 元信息存储在 meta.json 中
- `crud-api`: RESTful 数据 CRUD 接口，支持分页、过滤、排序、计数，基于页面级 SQLite 存储

### Modified Capabilities

- `page-serving`: PageMeta 结构变更，新增 schemas 字段用于存储 schema 定义

## Impact

- `packages/server/src/routes/` 新增 schema 管理和 CRUD 路由
- `packages/server/src/plugins/storage.ts` 的 PageMeta 接口需扩展 schemas 字段
- `packages/shared/src/api.ts` 可能需要新增 Schema 管理相关的请求/响应类型
- 每个 pageId 目录下新增 db.sqlite 文件

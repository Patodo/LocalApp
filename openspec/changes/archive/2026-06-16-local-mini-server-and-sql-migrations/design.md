## Context

LocalApp 当前 dev 模式直接代理所有 API 到生产 server,数据共享;schema 通过声明式 manifest.schemas 创建,无版本管理。这两个限制阻碍了"离线开发"和"安全演进 schema"。

本变更通过引入本地 mini-server 和用户手写 SQL migration 系统,把 dev/prod 数据完全隔离,让 schema 演进变成可审查的工程实践。设计目标是:**用户感知最小、生产稳定最强、AI 安全边界清晰**。

31 个关键决策点已在 explore 阶段与用户明确,本文档记录决策理由与实现取舍。

## Goals / Non-Goals

**Goals**:

- 本地 dev 完全自包含,数据写在 `.localapp/dev.db`,可随时 reset
- LLM 仍走生产 server(API key 不暴露);平台公共数据由本地 mini-server 转发生产 server 并缓存 5 分钟
- schema 演进通过用户手写 SQL migration,数字递增命名,可审查、可验证、可回滚(紧急时)
- upload 是原子操作,dist + migrations 一起发布,server 端事务保证
- AI 工具收紧:不再有 queryData/listSchemas,只通过应用注册的工具间接操作数据

**Non-Goals**:

- 不实现"声明式 schema → 自动 diff 生成 migration"(用户决定手写 SQL)
- 不支持 migration 反向应用(down migration),forward-only
- 不考虑应用所有者变更场景
- 不实现跨应用数据共享(每个 app 的 dev.db / app.db 完全隔离)
- 不在 CLI 二进制内嵌 server(改用 Node spawn)
- 不实现 git push 自动触发 server migration(用户主动 upload)

## Decisions

### 决策 1:server-core 抽离(而非跨 package import)

**选择**:把 `packages/server/src/lib/{app-db,crud,transitions,migration-engine...}` 抽到新 package `packages/server-core/`,生产 server 和 mini-server 都 import 这个共享层。

**理由**:
- 跨 package import(server → 直接引用 cli/runtime 的代码)违反 package 边界,长期维护痛苦
- 抽离的代价是一次性重构,收益是 dev/prod 行为一致(同一套 CRUD/权限/migration 代码)
- server-core 不含 HTTP 层,只暴露纯函数 + 数据库句柄

**未选方案**:
- 复制粘贴到 mini-server:维护两份,容易漂移
- CLI 内嵌 Rust 实现:跟生产 TypeScript 行为一致性难保证,且二进制 +20MB

**实现要点**:
- server-core 是 ESM TypeScript package,导出 schema/CRUD/migration 等函数
- 生产 server 把 routes 层重构为调用 server-core,HTTP 层只做参数解析
- mini-server.mjs 用 Node 内置 http(或极简 fastify),import server-core,实现有限端点集

### 决策 2:mini-server 由 CLI spawn(而非 Rust 内嵌)

**选择**:`localapp dev` Rust 命令 spawn 一个 Node 子进程跑 `runtime/mini-server.mjs`,随机分配端口,写入 dev-config.json,vite-plugin 读取。

**理由**:
- Rust 内嵌 fastify+sql.js 需要重写所有 server-core 逻辑,二进制膨胀,行为一致性难保
- Node spawn 复用生产 server-core,零代码重复
-localapp dev 本来就需要 Node(用户的 npm install),spawn Node 没有额外依赖

**实现要点**:
- mini-server.mjs 接受 `--port N --data-dir path --prod-server url` 参数
- Rust 端用 `std::process::Command::new("node")` spawn,stdout/stderr 转发
- 随机端口:尝试 5174-5200 范围,找到空闲端口后写入 dev-config.json
- vite-plugin 在 buildStart 钩子读 dev-config.json 的 `miniServerPort`,组装 proxy target

### 决策 3:vite-plugin 分流 + mini-server 平台数据缓存

**选择**:

```
/api/llm/*       → 生产 server (LLM 网关,用生产 API key)
其他 /api/*      → 本地 mini-server (应用数据 CRUD + /api/platform/* 转发缓存)
```

**理由**:
- LLM API key 不能放前端,必须由生产 server 代理
- 平台公共数据(users/groups/roles)由平台维护,跨应用共享,本地无需复制;dev 侧由 mini-server 转发并缓存 5 分钟,减少开发时远程请求延迟
- 应用层数据完全本地,与生产物理隔离,实现"reset 不影响生产"

**实现要点**:
- proxy 配置在 vite-plugin.mjs 的 buildProxy 函数,顺序敏感(`/api/llm/*` 优先匹配生产 server,其余 `/api/*` 匹配 mini-server)
- TTL 缓存由 mini-server 实现(`/api/platform/*` 转发时缓存 5 分钟,避免每个请求都打远程)
- mini-server 缓存命中时直接返回,缓存 miss 时调生产 server

### 决策 4:用户手写 SQL migration(废除 schemas 命令)

**选择**:

- 应用项目 `migrations/` 目录,文件名 `001_init.sql`、`002_add_priority.sql`、数字递增
- 纯 SQL(SQLite 方言),无 frontmatter,无 DSL
- CLI 提供 `localapp db migrate` 应用未应用的 migration 到 dev.db
- 废除 `localapp schemas create/update/delete` 命令
- 废除 manifest.json 的 `schemas` 数组

**理由**:
- 声明式 schema → 自动 diff 生成 SQL 的方案(类似 Prisma migrate dev)实现复杂,且 diff 算法对 rename/change type 不准确
- 用户手写 SQL 是工程界成熟实践(Rails、Phoenix、Alembic 都鼓励),LLM 也容易理解
- 数字递增命名简单直观,LocalApp 应用是单人/接力开发模式,git 冲突罕见

**未选方案**:
- 时间戳命名:数字递增在 LocalApp 场景足够,时间戳更难记
- 声明式 + 自动 diff:实现复杂,放弃
- 同时支持 schemas 命令 + SQL:双轨制增加心智负担

**实现要点**:
- migration 引擎在 server-core,提供 `getPendingMigrations(migrationsDir, dbConn)` 和 `applyMigration(dbConn, sql)` 函数
- 应用记录存在 `_localapp_applied_migrations` 表(每个 app.db / dev.db 各一份)
- 文件 checksum 用 SHA256,防止文件被篡改

### 决策 5:upload 原子化(dist + migrations 合并发布)

**选择**:

```
localapp upload
  1. npm run build → dist/
  2. 拉 prod app.db snapshot,本地应用 migrations 验证(validate)
  3. 打包 dist + migrations + manifest 为 bundle
  4. 上传到 server
  5. server 端:
     a. 校验 checksum,写 dist 到 staging 目录
     b. 备份 app.db → app.db.backup.vN(保留前两版本)
     c. BEGIN TRANSACTION
     d. 应用 pending migrations
     e. COMMIT
     f. rename staging 为 versions/v(N+1)/,原子切换 current 指针
     (失败 → ROLLBACK,app.db 不变,current 不切换)
```

**理由**:
- 用户明确要求"upload 归 upload,数据库更新由 server 执行和保证"
- 原子性保证:dist 和 db schema 同时升级,不会出现"代码用了新字段但 db 还没 migrate"的中间状态
- migration 文件上传到 server 后,server 自己执行,网络波动不影响(已落盘的文件可以慢慢跑)

**未选方案**:
- 独立 `localapp db push` 命令:增加心智负担,且无法保证 dist 跟 db 同步
- CLI 直接连 prod db:跨网络操作 prod 数据库,风险高

**实现要点**:
- bundle 格式:multipart upload,字段 `manifest`、`filepath_<index>` + `files`、`migration_<filename>`、`migrationChecksum_<filename>`
- server 端在 upload 处理流程里,先落盘所有文件到临时目录,再执行 transaction
- SQLite TRANSACTION 只保证数据库变更;dist 文件先写入 staging 目录,DB commit 成功后再通过 rename + current 指针切换对外可见。若任一步失败,回滚 DB transaction 并清理/隐藏 staging 目录。

### 决策 6:平台公共数据 API(只读)

**选择**:
- server 暴露 `/api/platform/users`、`/api/platform/groups`、`/api/platform/roles` 等只读端点
- 应用通过 SDK `usePlatformData("users")` hook 访问
- dev 时,vite-plugin 转发到生产 server;mini-server 加 5 分钟 TTL 缓存
- 生产时,直接由 server 内部 platform-data 模块处理

**理由**:
- 平台表(users/groups/roles)由平台维护,跟 server 版本绑定
- 应用不应直接接触平台 db 文件,只通过 API 读
- read-write 表(应用层)和 read-only 表(平台层)概念不存在 — 应用所有表都是 read-write,平台表通过专属 API 暴露

**实现要点**:
- 平台数据 API 走鉴权(req.apiKey),返回的字段由后端权限管控
- SDK 内置 TypeScript 类型(`PlatformUser`、`PlatformGroup` 等),跟 server-core 同步
- `usePlatformData` hook 接口与 `useList` 一致,内部走 `/api/platform/<resource>`

### 决策 7:平台版本 semver 声明

**选择**:
- manifest.json 新增 `platformVersion: "^1.0"` 字段
- CLI `localapp upload` 时,server 检查 semver 兼容性
- 主版本不匹配(应用 ^1.0,server 已升 2.0)→ 拒绝 upload,提示升级
- 平台升级时,server 端运行统一迁移脚本,把所有 app.db 升级到新平台版本

**理由**:
- 平台表 schema 跟 server 版本绑定,需要明确兼容性承诺
- semver 是行业标准,开发者熟悉
- 主版本不兼容时拒绝 upload,强制应用开发者主动适配,避免运行时崩溃

**实现要点**:
- server 启动时记录自己的 platformVersion
- upload 接收 manifest 后,parse platformVersion 字段,跟自身对比
- 平台升级流程:server 维护一组 `platform-migrations/*.sql`,启动时应用到所有 app.db(跟应用 migration 分开)

### 决策 8:AI 工具收紧(移除 queryData/listSchemas)

**选择**:
- DevShell 系统工具只保留 `getCurrentUser`
- 移除 `queryData`(直接 db 查询)和 `listSchemas`(直接 schema 查询)
- AI 通过应用 `useRegisterTools` 注册的工具间接操作数据
- 后续平台可开放更多 API 类系统工具(navigateToPage、sendNotification 等)

**理由**:
- AI 直接查 db 是"上帝视角",绕过应用层权限/审计/业务规则
- 数据操作必须走应用代码(SDK hooks),保证权限检查和日志
- AI 不需要"理解 schema" — 它通过应用源代码(useList 调用、interface 定义)和用户描述理解应用

**实现要点**:
- dev-shell.tsx 的 SYSTEM_TOOLS 数组只保留 getCurrentUser
- 应用通过 useRegisterTools 注册的工具不变,可任意(读/写/删),应用开发者全权负责

### 决策 9:TypeScript 类型反向生成

**选择**:
- `localapp db types -o src/types.ts` 命令
- 读 dev.db 的 `PRAGMA table_info(<table>)`,根据 SQLite 类型映射 TypeScript
- 平台数据类型由 SDK 内置(PlatformUser、PlatformGroup 等),跟 server-core 同步

**理由**:
- 字段定义在 SQL,不在 manifest,需要从 db 反向解析
- SQLite 类型 → TS 类型映射规则简单(INTEGER→number, TEXT→string, REAL→number, BLOB→Uint8Array)
- 平台表类型由 SDK 提供,跟随 server 升级自动更新

### 决策 10:从 manifest.schemas 自动迁移

**选择**:
- CLI 提供 `localapp migrate-from-manifest` 一次性命令
- 读 manifest.schemas,生成 `migrations/001_initial_from_manifest.sql`,包含所有 CREATE TABLE
- 备份 manifest.json 到 manifest.json.bak,移除 schemas 字段
- 应用所有 manifest.schemas 的业务规则(transitions/recordAccess)保留到 manifest.business

**理由**:
- 现有项目迁移成本必须最小化,自动转换工具降低门槛
- 生成的初始 SQL 可被用户审查、修改,符合"用户对 SQL 完全控制"的设计

## Risks / Trade-offs

- **[Risk] server-core 抽离影响生产 server** → **缓解**:Phase 1 只移动代码不改逻辑,生产 server 重构后跑全量测试套件,确认无回归才合入
- **[Risk] mini-server 行为跟生产有差异** → **缓解**:共享 server-core 保证逻辑一致;mini-server 实现后跑同一套 server-core 单测
- **[Risk] 用户写错 SQL 导致 migration 卡住** → **缓解**:validate 阶段在 prod snapshot 上跑 migration,失败拒绝 upload,生产永远安全
- **[Risk] 现有项目迁移失败** → **缓解**:`migrate-from-manifest` 命令保留 manifest.json.bak,失败可手动恢复;提供详细错误日志
- **[Risk] AI 移除 queryData 后用户体验下降** → **缓解**:应用通过 useRegisterTools 注册等价工具(如 getTasks),AI 仍能查询数据
- **[Trade-off] CLI 不内嵌 server,需要 Node** → 已是 localapp dev 的既有前提,无新依赖
- **[Trade-off] migration forward-only,无 down** → 紧急时用 backup 恢复,代价是数据丢失;行业标准做法
- **[Trade-off] 大变更 scope 4-6 周** → 分 Phase 推进,每个 Phase 独立可合入 main

## Migration Plan

按 Phase 1-10 分阶段,每个 Phase 独立可验证:

1. **Phase 1**:server-core 抽离 — 生产 server 重构,无用户行为变化
2. **Phase 2**:mini-server 实现 — 不动生产,只在 init-repo/runtime 加新文件
3. **Phase 3**:vite-plugin 分流 — 配置层改动,可灰度
4. **Phase 4**:migration 引擎 — server-core 加新功能,生产 server 暴露新端点
5. **Phase 5**:upload 原子流程 — server 端 upload.ts 重构,旧流程废弃
6. **Phase 6**:平台数据 API + SDK hook — 新增功能,不影响现有
7. **Phase 7**:db types + seed 机制 — 新增 CLI 命令,可选
8. **Phase 8**:validate + restore + status 命令 — 新增 CLI 命令
9. **Phase 9**:旧 schemas 命令废弃 + 文档 — BREAKING,需要发布说明
10. **Phase 10**:migrate-from-manifest 工具 — 迁移辅助

**回滚策略**:每个 Phase 独立 commit + 可独立 revert。生产 server 端 BREAKING 变更(Phase 5、9)需要版本号 bump + 发布说明。

## Open Questions

无。所有 31 个关键决策已在 explore 阶段明确。

## MODIFIED Requirements

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

## ADDED Requirements

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

## 1. RED：锁定 backend 契约与 JSON Schema

- [x] 1.1 在 server-core 增加失败测试：manifest `backend.root` 能发现 schema/query/mutation 文件
- [x] 1.2 在 server-core 增加失败测试：`backend.include` 未匹配文件时报错
- [x] 1.3 在 server-core 增加失败测试：backend JSON 缺少 `$schema` 时报错
- [x] 1.4 在 server-core 增加失败测试：重复 resource schema name 报错
- [x] 1.5 在 server-core 增加失败测试：named SQL 引用未知参数或未声明参数时报错
- [x] 1.6 在 server-core 增加失败测试：query 包含写入/DDL、多语句或危险 PRAGMA 时 validate 失败
- [x] 1.7 验证：运行相关 server-core 测试，确认新增测试按预期失败

## 2. GREEN：实现 backend 契约解析与 schema 校验

- [x] 2.1 在 server-core 新增 backend-contract 模块和公开类型
- [x] 2.2 实现 `backend.root` 和 `backend.include` 文件发现
- [x] 2.3 定义并内置 backend/resource-schema/queries/mutations 的 JSON Schema draft 2020-12 文件
- [x] 2.4 实现 `$schema` 必填和 schema URL / 本地 schema ID 映射校验
- [x] 2.5 实现 resource schema、query、mutation 文件解析和命名冲突检测
- [x] 2.6 实现 params schema 校验、系统参数保留名校验、未知参数校验
- [x] 2.7 实现 SQL kind 安全校验：query 只读，mutation 禁止多语句、DDL、ATTACH、DETACH、危险 PRAGMA
- [x] 2.8 验证：运行 server-core backend-contract 测试通过
- [x] 2.9 提交：提交 backend 契约解析与 JSON Schema 校验，提交信息使用 `feat(backend-contract): 解析应用后端契约`

## 3. RED：锁定 named SQL 运行时安全边界

- [x] 3.1 在 server-core 增加失败测试：`executeNamedSql` 只执行注册 SQL，忽略或拒绝请求体 sql 字段
- [x] 3.2 在 server-core 增加失败测试：参数类型错误、缺失 required、传入未声明参数均拒绝执行
- [x] 3.3 在 server-core 增加失败测试：`:currentUserId`、`:ownerId`、`:now` 由服务端注入且不可被前端覆盖
- [x] 3.4 在 server-core 增加失败测试：未通过 access 检查时 query/mutation 均不执行 SQL
- [x] 3.5 在 production server 增加失败测试：`POST /api/queries/:name` 和 `/api/mutations/:name` 行为符合 named SQL 契约
- [x] 3.6 在 mini-server 增加失败测试：本地 named SQL 行为与 production server 一致
- [x] 3.7 验证：运行相关测试，确认新增测试按预期失败

## 4. GREEN：实现 named SQL API 与共享执行器

- [x] 4.1 在 server-core 实现 `resolveNamedSql`、`validateNamedSqlParams`、`injectSystemParams`、`executeNamedSql`
- [x] 4.2 在 production server 新增 `/api/queries/:name` 和 `/api/mutations/:name` 页面级端点
- [x] 4.3 在 mini-server 新增同名端点并复用 server-core 执行器
- [x] 4.4 确保 production server 和 mini-server 均从同一 backend 契约解析结果执行 SQL
- [x] 4.5 实现 named SQL access 检查，支持 public/authenticated/owner 以及已有 group 语义
- [x] 4.6 实现 query rows 和 mutation result 的统一响应格式
- [x] 4.7 验证：运行 server-core、server integration、mini-server 相关测试通过
- [x] 4.8 提交：提交 named SQL API，提交信息使用 `feat(named-sql): 提供注册式 SQL 端点`

## 5. RED：锁定 SDK、CRUD 兼容和 raw SQL 降级

- [x] 5.1 在 sdk-core 增加失败测试：`client.query(name, params)` 调用 `/api/queries/:name`
- [x] 5.2 在 sdk-core 增加失败测试：`client.mutate(name, params)` 调用 `/api/mutations/:name`
- [x] 5.3 在 SDK/CRUD 测试中增加失败测试：资源 API 可使用系统 named endpoint 并保持既有返回 shape
- [x] 5.4 在 raw-sql 测试中增加失败测试：普通应用使用者不能通过 `/api/db/exec` 执行任意 SQL
- [x] 5.5 在 init-repo skill 文档测试中增加失败测试：不再推荐前端 `client.exec(sql)` 作为生产应用数据方案
- [x] 5.6 验证：运行相关测试，确认新增测试按预期失败

## 6. GREEN：实现 SDK 与兼容迁移

- [x] 6.1 在 sdk-core 增加 `query()` / `mutate()` 方法和类型
- [x] 6.2 在 sdk-react 增加 named query / mutation hook 或 helper
- [x] 6.3 让资源 API 支持优先调用项目注册的系统 named endpoint，缺失时 fallback 到旧 CRUD
- [x] 6.4 将 `client.exec()` 标记为兼容/调试路径，更新错误提示和文档指引
- [x] 6.5 调整 raw SQL endpoint 默认访问策略，普通使用者默认不能执行任意 SQL
- [x] 6.6 更新 init-repo skills：自定义 SQL 必须写入 backend named SQL 文件，不能写入前端代码
- [x] 6.7 验证：运行 SDK、server raw-sql、init-repo skill 相关测试通过
- [x] 6.8 提交：提交 SDK 与 raw SQL 迁移，提交信息使用 `feat(sdk): 支持注册式后端查询`

## 7. RED：锁定 init-repo 后端目录与上传同步

- [x] 7.1 在 init-repo 模板测试中增加失败测试：新项目包含 backend 目录、resource schema、queries、mutations 和 schemas 文件
- [x] 7.2 在 CLI validate 测试中增加失败测试：缺失 `$schema`、重复 schema、危险 SQL、未知参数均阻断上传
- [x] 7.3 在 CLI upload 测试中增加失败测试：backend 契约文件随版本上传，未声明文件不进入契约
- [x] 7.4 在 CLI sync 测试中增加失败测试：backend 目录和 JSON Schema 文件被同步到下游项目
- [x] 7.5 在 CLI generate 测试中增加失败测试：schema/resource 脚手架写入 `backend/resources/<name>/` 且不再写入 `schemas/<name>.json`
- [x] 7.6 在 CLI 命令测试中增加失败测试：历史 `schemas create/update/delete` 命令只输出弃用提示，不再写平台 schema
- [x] 7.7 验证：运行相关测试，确认新增测试按预期失败

## 8. GREEN：实现模板、validate、upload、sync

- [x] 8.1 在 init-repo 添加默认 backend 目录和 `$schema` 引用
- [x] 8.2 添加应用级 SQLite 预置接口配置：list/get/count/create/update/delete
- [x] 8.3 添加自定义 query / mutation 示例和 dashboard 聚合示例
- [x] 8.4 在 CLI validate 中接入 backend 契约解析与 schema 校验
- [x] 8.5 在 CLI upload 中打包 backend 契约和契约 manifest
- [x] 8.6 在 CLI sync 中覆盖同步 backend 目录和本地 JSON Schema 文件
- [x] 8.7 将 CLI schema/resource 生成能力改为写入 backend resource 契约文件，并移除旧 `schemas/*.json` 提示
- [x] 8.8 将历史 `localapp schemas create/update/delete` 收敛为弃用提示或移除命令入口
- [x] 8.9 更新 init-repo 技能、references 和 docs，说明平台数据接口与应用数据接口边界
- [x] 8.10 验证：运行 init-repo、CLI validate/upload/sync/generate 相关测试通过
- [x] 8.11 提交：提交模板和 CLI 集成，提交信息使用 `feat(init): 内置应用后端契约`

## 9. REFACTOR：收敛架构与文档

- [x] 9.1 整理 server-core backend-contract 模块边界，避免 production server 和 mini-server 重复解析逻辑
- [x] 9.2 收敛 JSON Schema URL、本地 schema ID、版本命名和错误信息
- [x] 9.3 更新 OpenSpec 相关主规格或 docs，说明 `$schema` 采用 JSON Schema draft 2020-12
- [x] 9.4 检查 SDK、skills 和 references 中是否仍有生产前端 raw SQL 推荐
- [x] 9.5 检查 CLI help、generate 输出、skills 和 references 中是否仍有 `localapp schemas create` 或旧 `schemas/*.json` 工作流
- [x] 9.6 验证：运行 `rg "client.exec|/api/db/exec|raw SQL|localapp schemas|schemas/"` 检查文档和模板语义
- [x] 9.7 验证：运行相关单元测试和模板测试通过
- [x] 9.8 提交：提交结构和文档收敛，提交信息使用 `refactor(backend-contract): 收敛契约执行边界`

## 10. 端到端验证

- [x] 10.1 运行 `pnpm -C packages/server-core test` 或仓库对应 server-core 测试命令
- [x] 10.2 运行 `pnpm -C packages/server test` 或仓库对应 server 测试命令
- [x] 10.3 运行 `pnpm -C init-repo test`
- [x] 10.4 运行 `pnpm -C init-repo build`
- [x] 10.5 编译 debug CLI
- [x] 10.6 在临时项目或 `sample-app` 使用 debug CLI 执行 `localapp sync`
- [x] 10.7 在同步后的项目中验证 named query / mutation、本地 mini-server、生产兼容 fallback 和 raw SQL 拒绝策略
- [x] 10.8 清理验证产生的临时进程、日志和测试数据
- [x] 10.9 提交：提交端到端验证记录，提交信息使用 `test(backend-contract): 验证应用后端契约`

## 11. 最终验收

- [x] 11.1 运行 `openspec validate add-backend-contract-files --strict`
- [x] 11.2 运行仓库可承受的全量测试或记录跳过原因
- [x] 11.3 检查 `git diff`，确认没有混入目标项目文件、临时文件或构建产物
- [x] 11.4 更新任务完成状态和不可自动化验证说明
- [x] 11.5 最终提交，提交信息使用 `chore(backend-contract): 完成应用后端契约方案`

### 验证说明

- 7.7 的 RED 失败输出未保留在日志中；后续已通过 CLI 单元测试覆盖 validate/upload/sync/generate/schemas 收敛场景，并在实现前后确认这些断言由失败转为通过。
- 10.7 的 named query/mutation、mini-server 与 raw SQL 拒绝策略由 `packages/server-core`、`packages/server`、`init-repo` 测试覆盖；真实 debug CLI 额外在临时项目执行 `localapp sync --quiet`，确认 backend 契约、mini-server runtime 和 dev-shell runtime 能被同步。
- 常规 `packages/cli/target/debug/localapp.exe` 在 Windows 上被现有进程锁定，`cargo build` 无法覆盖该文件；debug CLI 使用隔离 `target-codex-cli` 构建完成并完成同步验证，验证后清理该临时 target。
- merge-review 后补齐两项规格缺口：init-repo 现在包含 `backend/schemas/*.schema.json` 本地 JSON Schema 文件；validate 现在会检查 named SQL 的未知资源/字段引用，并在 `db validate` 迁移后检查 backend resource schema 与 SQLite 表字段一致。
- 第二轮 merge-review 后补齐 manifest backend 配置贯穿：CLI init/upload/db validate、server upload/serve、mini-server 均支持 `backend.root/include`；upload 的 recent validation marker 现在包含 backend contract checksums；`localapp init` 自动部署会上传 backend contract 文件。

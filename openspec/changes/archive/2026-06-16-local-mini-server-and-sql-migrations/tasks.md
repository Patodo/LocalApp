## 1. Phase 1: server-core 抽离

抽出 packages/server 的核心逻辑到新 package `packages/server-core/`,生产 server 重构为引�?server-core。本阶段无用户行为变�?验证无回归�?
- [x] 1.1 RED:新增 packages/server-core package,编写单测覆盖核心函数(createTable、alterTableAddColumn、selectMany、insertRow、updateRow、deleteRow)的当前行�?- [x] 1.2 GREEN:�?packages/server/src/lib/{app-db.ts, access-control.ts, transitions.ts} 移到 packages/server-core/src/,export 全部公共 API;packages/server 改为 import �?@localapp/server-core
- [x] 1.3 验证:运行 packages/server 原有测试套件全部通过;无回�?- [x] 1.4 REFACTOR:清理 packages/server/src/lib 下重复文�?确认所有引用已切换�?server-core
- [x] 1.5 验证:server 启动 + e2e 测试通过
- [x] 1.6 提交:`refactor(server): 抽离 server-core 共享层`

## 2. Phase 2: mini-server.mjs 实现

�?init-repo/runtime/ 新增 mini-server.mjs,提供应用�?API,数据写入 dev.db�?
- [x] 2.1 RED:编写单测覆盖 mini-server.mjs 的命令行参数解析(--port�?-data-dir�?-prod-server�?-api-key)
- [x] 2.2 GREEN:实现 mini-server.mjs 入口,解析参数,初始�?http server
- [x] 2.3 验证:参数解析测试通过
- [x] 2.4 RED:编写测试覆盖 mini-server 启动时应�?migrations �?dev.db(�?db �?创建 + 应用所�?migration;已有 db �?应用未应用的)
- [x] 2.5 GREEN:实现 mini-server 启动流程,使用 server-core �?migration 引擎
- [x] 2.6 验证:启动测试通过
- [x] 2.7 RED:编写测试覆盖 /api/me 端点返回 mock 用户 `{ id: "dev-user", name: "Dev User", role: "owner" }`
- [x] 2.8 GREEN:实现 /api/me 端点
- [x] 2.9 验证:测试通过
- [x] 2.10 RED:编写测试覆盖 /api/<resource> CRUD 端点,使用 server-core 函数,数据写入 dev.db
- [x] 2.11 GREEN:实现 CRUD 路由,复用 server-core
- [x] 2.12 验证:CRUD 测试通过
- [x] 2.13 RED:编写测试覆盖 /api/upload 端点把文件保存到 .localapp/dev-uploads/
- [x] 2.14 GREEN:实现本地 upload 端点
- [x] 2.15 验证:测试通过
- [x] 2.16 RED:编写测试覆盖 /api/platform/* 转发到生�?server,�?5 分钟 TTL 缓存
- [x] 2.17 GREEN:实现 platform 转发 + 缓存逻辑
- [x] 2.18 验证:测试通过
- [x] 2.19 RED:编写测试覆盖 mini-server 收到 SIGTERM 时优雅退�?flush db,关闭 http)
- [x] 2.20 GREEN:实现信号处理
- [x] 2.21 验证:测试通过
- [x] 2.22 提交:`feat(init-template): 实现 mini-server.mjs 本地数据 server`

## 3. Phase 3: vite-plugin 分流

vite-plugin.mjs 在已�?dev-config 字段基础�?新增读取 miniServerPort,�?`/api/llm/*` 走生�?server,其他 `/api/*`(包含 `/api/platform/*`)�?mini-server 分流。平台数�?TTL 缓存�?mini-server 负责�?
- [x] 3.1 RED:扩展 vite-plugin.test.ts,断言 dev-config.json �?miniServerPort �?buildProxy 返回 llm→serverUrl、其�?/api→miniServer �?proxy 配置
- [x] 3.2 GREEN:修改 buildProxy 函数,按路径前缀分流�?prodServer �?miniServer
- [x] 3.3 验证:测试通过
- [x] 3.4 RED:编写测试覆盖 /api/llm/* 走生�?server,/api/platform/* 和其�?/api/* �?mini-server
- [x] 3.5 GREEN:调整 proxy 配置顺序(llm 优先匹配,其余 /api 兜底�?mini-server)
- [x] 3.6 验证:测试通过
- [x] 3.7 RED:编写测试覆盖 dev-config.json �?miniServerPort �?降级为旧行为(全部�?serverUrl)+ 打印警告
- [x] 3.8 GREEN:实现降级逻辑
- [x] 3.9 验证:测试通过;手动启动 dev 确认数据走本�?- [x] 3.10 提交:`feat(init-template): vite-plugin �?miniServerPort 分流 /api/*`

## 4. Phase 4: SQL migration 引擎

�?server-core 实现 migration 引擎,提供应用/查询/记录迁移历史的能力�?
- [x] 4.1 RED:编写单测覆盖 migration 文件命名规则校验(数字递增 + .sql 扩展�?
- [x] 4.2 GREEN:实现 `validateMigrationFilenames(filenames)` 函数,返回 { valid, errors }
- [x] 4.3 验证:测试通过
- [x] 4.4 RED:编写测试覆盖 _localapp_applied_migrations 表的创建和查�?- [x] 4.5 GREEN:实现 `ensureAppliedMigrationsTable(dbConn)` 函数
- [x] 4.6 验证:测试通过
- [x] 4.7 RED:编写测试覆盖 getPendingMigrations(migrationsDir, dbConn) 返回未应用文件列�?按数字顺�?
- [x] 4.8 GREEN:实现 getPendingMigrations 函数,读目�?+ 比对 applied �?- [x] 4.9 验证:测试通过
- [x] 4.10 RED:编写测试覆盖 applyMigration(dbConn, filename, sql),在事务中应用 + 记录 checksum + 写入 applied �?- [x] 4.11 GREEN:实现 applyMigration 函数
- [x] 4.12 验证:测试通过
- [x] 4.13 RED:编写测试覆盖 migration 文件�?ATTACH/DETACH 时拒�?破坏事务)
- [x] 4.14 GREEN:实现破坏�?SQL 检�?拒绝执行
- [x] 4.15 验证:测试通过
- [x] 4.16 RED:编写测试覆盖已应�?migration 文件被修�?checksum 变化)时拒绝继�?- [x] 4.17 GREEN:实现 checksum 验证
- [x] 4.18 验证:测试通过
- [x] 4.19 提交:`feat(server-core): 实现 SQL migration 引擎`

## 5. Phase 5: upload 原子流程

重构 server �?upload 路由,改为防御式原子发�?接收 dist + migrations + manifest bundle,validate 已在上传前降�?migration 意外风险;server 端仍使用 DB transaction + staging dist + current 指针切换处理运行时异�?失败�?app.db 不变且新 dist 不可见�?
- [x] 5.1 RED:编写 server 集成测试覆盖 upload bundle 包含 migrations �?事务应用 + 部署 dist + commit
- [x] 5.2 GREEN:重构 upload 路由,实现原子流程
- [x] 5.3 验证:测试通过
- [x] 5.4 RED:编写测试覆盖 migration 应用失败�?事务 ROLLBACK,app.db 不变,dist 未部�?- [x] 5.5 GREEN:实现事务回滚逻辑
- [x] 5.6 验证:测试通过
- [x] 5.6a RED:编写测试覆盖 dist staging 写入成功�?DB transaction 失败�?current 指针不切换且 staging 被清�?保持不可�?- [x] 5.6b GREEN:实现 staging 目录 + current 指针原子切换,把文件系统可见性从 DB transaction 中解�?- [x] 5.6c 验证:测试通过
- [x] 5.7 RED:编写测试覆盖 backup 策略(首次 backup �?v1;第二次升�?v1 �?v2;第三次淘汰旧 v2)
- [x] 5.8 GREEN:实现 backup 升级函数
- [x] 5.9 验证:测试通过
- [x] 5.10 RED:编写测试覆盖 checksum 验证(bundle �?migration checksum �?CLI 声明不一致时拒绝)
- [x] 5.11 GREEN:实现 checksum 验证
- [x] 5.12 验证:测试通过
- [x] 5.13 RED:编写测试覆盖 manifest �?schemas 字段时不报错(向后兼容)
- [x] 5.14 GREEN:调整 manifest 解析逻辑,允许 schemas 字段缺失
- [x] 5.15 验证:测试通过;手动 upload 测试项目确认流程
- [x] 5.16 提交:`feat(server): upload 改为原子发布,支持 migrations 应用 + dist staging`

## 6. Phase 6: 平台数据 API + SDK usePlatformData

server 端实�?/api/platform/* 只读端点;SDK 新增 usePlatformData hook + 内置平台类型�?
- [x] 6.1 RED:编写 server 测试覆盖 GET /api/platform/users 返回所有用�?- [x] 6.2 GREEN:实现 platform-data 路由,�?users �?- [x] 6.3 验证:测试通过
- [x] 6.4 RED:编写测试覆盖 POST /api/platform/users 返回 405
- [x] 6.5 GREEN:实现 method 限制
- [x] 6.6 验证:测试通过
- [x] 6.7 RED:编写测试覆盖 GET /api/platform/groups�?api/platform/roles 端点
- [x] 6.8 GREEN:扩展 platform-data 路由
- [x] 6.9 验证:测试通过
- [x] 6.10 RED:编写 server-core 测试覆盖 GET /api/platform/version 返回 server 版本
- [x] 6.11 GREEN:实现 version 端点
- [x] 6.12 验证:测试通过
- [x] 6.13 RED:编写 CLI 测试覆盖 `localapp platform version` 拉取 `/api/platform/version` 并显�?manifest platformVersion 兼容状�?- [x] 6.14 GREEN:实现 `localapp platform version` 命令�?semver range 检�?- [x] 6.15 验证:测试通过
- [x] 6.16 RED:编写 upload/validate 测试覆盖 platformVersion 缺失警告、非�?range 阻断、主版本不兼容拒�?upload
- [x] 6.17 GREEN:�?CLI validate �?server upload 中实�?platformVersion 校验
- [x] 6.18 验证:测试通过
- [x] 6.19 RED:编写 server 测试覆盖启动时扫�?`platform-migrations/*.sql`,记录 `_localapp_applied_platform_migrations`
- [x] 6.20 GREEN:实现平台迁移引擎,仅允许影响平台表(users/groups/roles)
- [x] 6.21 验证:测试通过
- [x] 6.22 RED:编写测试覆盖 platform migration 失败时标�?app �?`needs-migration-repair`,并拒绝该 app 后续 upload
- [x] 6.23 GREEN:实现失败标记�?upload 拦截
- [x] 6.24 验证:测试通过
- [x] 6.25 RED:编写 SDK 测试覆盖 usePlatformData("users") 发起 GET /api/platform/users 请求
- [x] 6.26 GREEN:实现 usePlatformData hook
- [x] 6.27 验证:测试通过
- [x] 6.28 RED:编写测试覆盖 TypeScript 类型 PlatformUser、PlatformGroup、PlatformRole �?SDK 导出
- [x] 6.29 GREEN:�?sdk-react 新增类型定义
- [x] 6.30 验证:测试通过;手动在示例项目用 usePlatformData 验证
- [x] 6.31 提交:`feat(server,cli,sdk-react): 平台数据 API + platformVersion 兼容检查`

## 7. Phase 7: db types + seed 机制

CLI 实现 localapp db types 反向生成 TypeScript;实现 db/seeds/dev.sql seed 机制�?
- [x] 7.1 RED:编写 CLI 测试覆盖 localapp db types -o file �?dev.db PRAGMA 生成 interface
- [x] 7.2 GREEN:实现 db types 命令,�?PRAGMA table_info,生成 TS interface
- [x] 7.3 验证:测试通过
- [x] 7.4 RED:编写测试覆盖排除 _localapp_* 内部�?- [x] 7.5 GREEN:实现过滤逻辑
- [x] 7.6 验证:测试通过
- [x] 7.7 RED:编写测试覆盖 SQLite 类型�?TS 类型映射(INTEGER→number, TEXT→string, BLOB→Uint8Array)
- [x] 7.8 GREEN:实现类型映射函数
- [x] 7.9 验证:测试通过
- [x] 7.10 RED:编写 CLI 测试覆盖 localapp db reset 时应�?db/seeds/dev.sql(存在则应�?不存在则跳过)
- [x] 7.11 GREEN:实现 db reset 命令�?seed 应用步骤
- [x] 7.12 验证:测试通过
- [x] 7.13 RED:编写测试覆盖 upload bundle 不包�?db/seeds/ 目录
- [x] 7.14 GREEN:�?CLI upload 流程显式排除 db/seeds/
- [x] 7.15 验证:测试通过
- [x] 7.16 提交:`feat(cli): db types 反向生成 + db/seeds/dev.sql seed 机制`

## 8. Phase 8: validate + restore + status 命令

CLI 实现 localapp db validate、localapp db restore、localapp db status 命令;upload 集成 validate 前置�?
- [x] 8.1 RED:编写 CLI 测试覆盖 localapp db validate �?prod snapshot、应�?pending migrations、记�?.last-validated
- [x] 8.2 GREEN:实现 validate 命令
- [x] 8.3 验证:测试通过
- [x] 8.4 RED:编写测试覆盖 validate 离线时拒�?- [x] 8.5 GREEN:实现网络检�?- [x] 8.6 验证:测试通过
- [x] 8.7 RED:编写测试覆盖 validate 失败�?prod-snapshot.db 保留
- [x] 8.8 GREEN:实现失败时保留逻辑
- [x] 8.9 验证:测试通过
- [x] 8.10 RED:编写测试覆盖 localapp upload 强制 validate 前置(�?.last-validated 时自动触�?
- [x] 8.11 GREEN:�?upload 流程加入 validate 前置检�?- [x] 8.12 验证:测试通过
- [x] 8.13 RED:编写测试覆盖 --skip-validate 要求 --confirm-project-name 标志
- [x] 8.14 GREEN:实现危险标志确认
- [x] 8.15 验证:测试通过
- [x] 8.16 RED:编写测试覆盖 localapp db restore --backup v1 调用 server /api/db/restore
- [x] 8.17 GREEN:实现 restore 命令 + server 端点
- [x] 8.18 验证:测试通过
- [x] 8.19 RED:编写测试覆盖 localapp db status 输出已应�?未应�?migration 列表
- [x] 8.20 GREEN:实现 status 命令
- [x] 8.21 验证:测试通过;手动跑完整流�?migrate �?validate �?upload �?restore)
- [x] 8.22 提交:`feat(cli): db validate + restore + status 命令,upload 强制 validate 前置`

## 9. Phase 9: �?schemas 命令废弃 + 文档

移除 localapp schemas 命令�?manifest.schemas 字段不再被读�?更新 CLAUDE.md / skills 文档�?
- [x] 9.1 RED:编写测试断言 localapp schemas create 命令不存�?clap 解析失败)
- [x] 9.2 GREEN:�?cli/src/commands 移除 schemas.rs,移除 cli/main.rs 中的命令注册
- [x] 9.3 验证:测试通过
- [x] 9.4 RED:编写 server 测试断言 POST /api/schemas 端点返回 410 Gone(向后兼容提示)
- [x] 9.5 GREEN:server �?schemas 路由返回 410 + 提示信息
- [x] 9.6 验证:测试通过
- [x] 9.7 RED:编写测试断言 manifest.json �?schemas 字段�?CLI 打印 deprecation 警告(不阻�?
- [x] 9.8 GREEN:CLI 启动时检�?manifest.schemas,打印警告
- [x] 9.9 验证:测试通过
- [x] 9.10 修改 init-repo/CLAUDE.md:更新「核心规则」章�?移除 "localapp schemas create" 相关条目,新增 "�?SQL migration" 指引
- [x] 9.11 修改 init-repo/.claude/skills/localapp-data.md:更新数据建模章节,改为 SQL migration 流程
- [x] 9.12 修改 init-repo/.claude/skills/localapp.md:更新 CLI 命令参�?移除 schemas 命令,新增 db 命令�?- [x] 9.13 验证:阅读文档确认清晰准确;init-repo 测试套件无回�?- [x] 9.14 提交:`feat(cli,init-template): 废弃 localapp schemas 命令�?改为 SQL migration 流程`

## 10. Phase 10: migrate-from-manifest 迁移工具

CLI 实现 localapp migrate-from-manifest 一次性命�?自动把现有项目的 manifest.schemas 转换为初�?SQL migration�?
- [x] 10.1 RED:编写 CLI 测试覆盖 migrate-from-manifest �?manifest.schemas 生成 migrations/001_initial_from_manifest.sql
- [x] 10.2 GREEN:实现命令,生成 CREATE TABLE SQL
- [x] 10.3 验证:测试通过
- [x] 10.4 RED:编写测试覆盖备份 manifest.json �?manifest.json.bak,移除 schemas 字段
- [x] 10.5 GREEN:实现备份 + 字段移除
- [x] 10.6 验证:测试通过
- [x] 10.7 RED:编写测试覆盖 migrations/ 目录已存在时拒绝
- [x] 10.8 GREEN:实现冲突检�?- [x] 10.9 验证:测试通过
- [x] 10.10 RED:编写测试覆盖 manifest.json �?schemas 字段时跳�?打印提示)
- [x] 10.11 GREEN:实现 graceful skip
- [x] 10.12 验证:测试通过
- [x] 10.13 e2e:�?sample-app 项目(已有 manifest.schemas)上跑 migrate-from-manifest,验证转换正确
- [x] 10.14 e2e:转换后跑 localapp db migrate,确认 dev.db 正常工作
- [x] 10.15 e2e:�?localapp upload 验证 server �?atomic 流程
- [x] 10.16 提交:`feat(cli): migrate-from-manifest 自动转换 manifest.schemas �?SQL migration`

## 11. 完成检�?
- [x] 11.1 运行 init-repo 全部测试套件,所有测试通过
- [x] 11.2 运行 packages/server 全部测试套件,所有测试通过
- [x] 11.3 运行 packages/cli 全部测试套件,所有测试通过
- [x] 11.4 运行 packages/sdk-react 全部测试套件,所有测试通过
- [x] 11.5 运行 server �?e2e 测试套件,无回�?- [x] 11.6 手动验证:localapp init 创建新项�?�?dev 模式数据走本�?�?upload 验证 server atomic deploy
- [x] 11.7 手动验证:�?sample-app �?migrate-from-manifest,完整迁移流程
- [x] 11.8 提交剩余变更(如有)

## 12. 合入前检�?
- [x] 12.1 启动 merge-review agent 对变更做合入前一致性检�?- [x] 12.2 根据检视结果修复发现的问题
- [x] 12.3 归档变更�?openspec/changes/archive/<date>-<name>/
- [x] 12.4 合入 main 分支

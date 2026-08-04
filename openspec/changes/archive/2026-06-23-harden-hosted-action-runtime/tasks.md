## 1. RED：复现与失败测试

- [x] 1.1 为 `packages/server-core` 增加 hosted action 内 `Promise.all(ctx.query)` 的并发 RPC 测试，断言同一 dbPath 的 SQL 执行必须经过队列
- [x] 1.2 为页面普通 named SQL 与 action ctx SQL 同时访问同一 app DB 增加集成测试，先证明当前没有 per-db 串行化护栏
- [x] 1.3 为 action worker 异常退出、structured clone 失败和资源类错误增加失败测试，断言外部响应不能只暴露底层错误
- [x] 1.4 为 sql.js/WASM `memory access out of bounds` 模拟错误增加失败测试，断言返回 database runtime error 且内部保留原始错误摘要
- [x] 1.5 为同一应用 action 并发超过上限增加失败测试，断言平台不会无限创建 worker
- [x] 1.6 执行 RED 测试集，确认新增测试在实现前失败
- [x] 1.7 提交 RED 阶段测试，commit message 遵循 `test(action-runtime): 添加托管函数运行时护栏测试`

## 2. GREEN：数据库串行化与并发背压

- [x] 2.1 在 `server-core` 新增或扩展 per-db 队列工具，按 dbPath 串行执行数据库操作并记录等待时间
- [x] 2.2 将 `executeNamedSql`、`runDbTransaction` 和直接 app DB 操作接入 per-db 队列，确保 transaction 执行期间不插入其他同 DB 操作
- [x] 2.3 将 hosted action ctx 的 `query`、`mutate` 和 `transaction` 路径接入同一 per-db 队列
- [x] 2.4 为 per-db 队列增加等待超时和明确的 database busy/queue timeout 错误
- [x] 2.5 为同一 `{ownerId}/{appName}` 增加 action 并发 semaphore 或队列，并设置默认并发上限与等待超时
- [x] 2.6 在生产 serve route 和 init-repo mini-server 中使用相同 action 并发控制与错误响应路径
- [x] 2.7 执行 GREEN 相关测试，确认并发与队列测试通过
- [x] 2.8 提交 GREEN 阶段实现，commit message 遵循 `fix(action-runtime): 串行化应用数据库执行`

## 3. GREEN：错误归因与可观测性

- [x] 3.1 定义 action/database 错误分类与包装函数，覆盖 `action_timeout`、`action_resource_limit`、`action_runtime_error`、`db_runtime_error`、`db_contract_error`
- [x] 3.2 包装 worker `error`、`exit`、`postMessage` 失败和 `deserializeActionError` 路径，返回稳定的 `ActionError`
- [x] 3.3 包装 sql.js/WASM 底层错误，将 `WebAssembly.RuntimeError` 和 `memory access out of bounds` 转换为 database runtime error
- [x] 3.4 为 action 执行记录诊断摘要，包括 action 名称、应用标识、耗时、RPC 次数、SQL rows/bytes/ms、DB 队列等待时间和错误分类
- [x] 3.5 确保外部响应不泄漏完整底层栈或本地数据库文件路径，内部日志保留原始错误摘要
- [x] 3.6 执行错误归因与可观测性测试，确认错误文案和内部分类稳定
- [x] 3.7 提交错误归因阶段实现，commit message 遵循 `fix(action-runtime): 包装资源与数据库运行时错误`

## 4. REFACTOR：模板文档与运行时一致性

- [x] 4.1 更新 `init-repo/CLAUDE.md` 和 backend action README，明确 action 适用短事务写逻辑，不推荐无分页全量读模型
- [x] 4.2 更新 init-repo runtime 中的 server-core 或相关同步产物，确保 `localapp sync` 能下发新运行时
- [x] 4.3 检查生产 server 与 mini-server 的 action/named SQL 错误响应是否一致，消除重复实现
- [x] 4.4 补充或更新现有 OpenSpec 相关测试与文档测试，确保模板说明可被 CI 覆盖
- [x] 4.5 执行 REFACTOR 相关测试，确认模板与运行时同步通过
- [x] 4.6 提交 REFACTOR 阶段变更，commit message 遵循 `docs(action-runtime): 明确托管函数使用边界`

## 5. 验证与发布准备

- [x] 5.1 执行 `openspec validate harden-hosted-action-runtime --strict`
- [x] 5.2 执行 `pnpm -C packages/server-core test`
- [ ] 5.3 执行 `pnpm -C packages/server test`
- [x] 5.4 执行 `pnpm -C init-repo exec vitest run tests/mini-server.test.ts tests/template-ui.test.ts tests/skill-docs.test.ts`
- [x] 5.5 使用 v38 `sample-app` 的 `workload.listWorkRows` bundle 做本地复现脚本验证，确认小数据量 action 不再泄漏底层 WASM/worker 错误
- [ ] 5.6 启动或复用本地 server，登录 `example-user` 后访问 `sample-app`，确认当前版本应用仍可打开全量清单、我的、团队日报、后台配置
- [x] 5.7 重新构建 CLI，确认新 runtime 可通过 `localapp sync` 下发到下游应用
- [x] 5.8 执行最终 `git diff --check` 和 `git status --short`
- [x] 5.9 提交验证收尾，commit message 遵循 `chore(action-runtime): 完成运行时护栏验证`

验证备注：
- 5.3 已执行但未通过，失败集中在 CLI e2e 用例：`config-dir.test.ts`、`db.test.ts`、`update.test.ts`，不经过 hosted action runtime。
- 5.6 已完成 HTTP/API 冒烟：`/serve/example-user/sample-app/` 返回 200，主要分页 named SQL 返回正常；浏览器插件访问本地地址被客户端阻止，未完成真实 UI tab 点击验证。

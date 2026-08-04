## 1. RED：资源预算与错误分类测试

- [x] 1.1 为 hosted action runtime 添加失败测试：RPC 次数超限时返回稳定 `action_rpc_limit_exceeded` 类错误，handler 不继续执行。
- [x] 1.2 为 action `ctx.query` 添加失败测试：单次 rows、累计 rows、单次 bytes、累计 bytes 超限时返回明确预算错误。
- [x] 1.3 为 action 返回体添加失败测试：返回大数组或大对象超过 `maxResultBytes` 时返回 `action_result_too_large`，不暴露底层 structured clone 错误。
- [x] 1.4 为 action endpoint 添加集成失败测试：预算错误响应保持 `{ success: false, error, code }` 结构。
- [x] 1.5 执行测试确认 RED 阶段失败符合预期，并提交 `test(action-runtime): 添加资源预算失败用例`。

## 2. GREEN：实现 action 预算护栏

- [x] 2.1 在 `backend-actions.ts` 中引入 action runtime budget 配置，包含默认值和可选覆盖项。
- [x] 2.2 在 worker RPC 处理路径统计 RPC 次数、SQL rows、SQL bytes，并在超限时终止 action 调用。
- [x] 2.3 在 action 完成前估算返回值 bytes，超过预算时返回稳定 action result 错误。
- [x] 2.4 将预算错误接入 `ActionError`、endpoint 响应和诊断事件，记录 action 名称、appKey、rows、bytes、rpcCount 和 errorCode。
- [x] 2.5 执行相关 server-core/server 测试确认 GREEN，并提交 `fix(action-runtime): 增加 action 资源预算护栏`。

## 3. RED：全局 worker 调度与 appKey 队列测试

- [x] 3.1 添加失败测试：全局 action worker 达到上限时，新请求进入有界队列而不是立即创建新 worker。
- [x] 3.2 添加失败测试：同一 appKey 超过单应用并发上限时排队或返回稳定 concurrency 错误。
- [x] 3.3 添加失败测试：队列等待超时后返回 `action_queue_timeout`，handler 不执行。
- [x] 3.4 添加失败测试：应用版本变化、timeout、resource error 后热 worker 不被复用。（本阶段选择不启用热 worker，复用风险以无复用调度器规避。）
- [x] 3.5 执行测试确认 RED 阶段失败符合预期，并提交 `test(action-runtime): 添加 worker 调度失败用例`。

## 4. GREEN：实现平台预算驱动的 action worker 调度

- [x] 4.1 提取 action worker 调度器，统一管理全局 worker 上限、appKey 队列、等待超时和释放逻辑。
- [x] 4.2 将现有 per-app action concurrency 迁移到调度器，确保 worker 数不随请求数或应用数无限增长。
- [x] 4.3 实现按 `{ownerId}/{appName}/{version}` 绑定的可回收热 worker 机制或明确的无复用调度器接口，并保证 idle TTL、版本变化和异常退出会回收 worker。
- [x] 4.4 扩展 runtime diagnostics，记录活跃 worker 数、队列等待、拒绝原因、worker 复用/回收事件。
- [x] 4.5 执行相关测试确认 GREEN，并提交 `fix(action-runtime): 使用有界 worker 调度器`。

## 5. RED：named SQL 默认轻量路径测试

- [x] 5.1 添加 named SQL 结果预算失败测试：query rows 或 bytes 超限时返回可读 `named_sql_result_too_large` 类错误。
- [x] 5.2 添加 action ctx query 触发 named SQL 预算的失败测试，确认 action 收到稳定预算错误并记录 SQL 摘要。
- [x] 5.3 添加短事务/批量 mutation 规格对应的失败测试，覆盖多条注册 mutation 原子执行和失败回滚。
- [x] 5.4 执行测试确认 RED 阶段失败符合预期，并提交 `test(named-sql): 添加轻量路径预算与事务用例`。

## 6. GREEN：增强 named SQL 承载能力

- [x] 6.1 为 named SQL 执行路径增加 rows/bytes 预算配置和稳定错误包装。
- [x] 6.2 确保 action ctx SQL 与普通 named SQL 共用预算统计和诊断字段。
- [x] 6.3 实现短事务/批量 mutation 的最小可用能力，限制为同一 app DB 内的注册 mutation，不允许外部副作用。
- [x] 6.4 更新 SDK 或模板调用示例所需的类型/辅助函数，保持普通 CRUD、分页和聚合不依赖 action。（本阶段无需新增 SDK API，模板指引在文档阶段完成。）
- [x] 6.5 执行相关测试确认 GREEN，并提交 `fix(named-sql): 强化默认轻量后端路径`。

## 7. REFACTOR：模板、文档与开发者指引

- [x] 7.1 更新 `init-repo/CLAUDE.md`，明确 named SQL 是普通 CRUD、列表、分页、筛选和聚合的默认路径。
- [x] 7.2 更新 `init-repo/backend/actions/README.md`，说明 action 预算错误、适用场景和迁移建议。
- [x] 7.3 调整模板示例：列表读取使用 named query 分页或过滤，hosted action 只展示短事务写逻辑。
- [x] 7.4 更新相关 OpenSpec 文档或开发说明，避免“每个应用都应该写后端”的误导。
- [x] 7.5 执行模板构建/CLI 初始化相关测试，并提交 `docs(init-template): 明确 action 与 named SQL 使用边界`。

## 8. 验证与收尾

- [x] 8.1 运行 `pnpm -C packages/server-core test`、`pnpm -C packages/server test` 和相关 CLI/template 测试。
- [x] 8.2 运行 `openspec validate --all --strict` 和 `git diff --check`。
- [x] 8.3 使用测试应用验证 100 应用存在、少量 action 活跃时不会按应用数常驻创建 worker。
- [x] 8.4 汇总默认配置建议：轻量应用目标资源、worker 上限、预算阈值和调优入口。
- [x] 8.5 提交最终验证结果，commit message 使用 `chore(action-runtime): 完成轻量运行时验证`。

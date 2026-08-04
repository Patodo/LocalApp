## 1. RED: 契约和上传边界测试

- [ ] 1.1 添加 server-core contract 失败测试：声明 actor 但缺少 command contract、access、input schema、资源预算时必须失败。
- [ ] 1.2 添加 CLI validate/upload 失败测试：未声明 capability 却使用 `ctx.http`、`ctx.ai`、`ctx.storage` 等能力时必须失败或被标记为 runtime 禁用。
- [ ] 1.3 添加 server upload 失败测试：actor bundle 超过大小限制、包含旧 hosted action 文件、或混用 `backend/actions.*` 时不得创建新版本。
- [ ] 1.4 添加 serve 路由失败测试：未声明 actor 的应用调用 actor command API 时返回稳定 not enabled 错误，named SQL 仍可用。
- [ ] 1.5 运行 1.x 失败测试并确认 RED。
- [ ] 1.6 commit：`test(actor): 覆盖 backend actor 契约边界`

## 2. Spike: runtime 选型和稳定性门禁

- [ ] 2.1 编写 runtime spike 文档，对比 Node worker_threads、V8 isolate/isolated-vm、进程级 worker/workerd 风格方案。
- [ ] 2.2 为每个候选方案记录启动延迟、内存限制、崩溃隔离、bundle 格式、Node API 控制、依赖复杂度、本地开发兼容性。
- [ ] 2.3 用最小原型验证 actor 崩溃、超时、内存超限不会污染 named SQL。
- [ ] 2.4 根据 spike 结果更新 design.md 的选型决策或保留 experimental gate。
- [ ] 2.5 commit：`docs(actor): 完成 runtime 选型 spike`

## 3. GREEN: actor contract 和 upload/validate

- [ ] 3.1 在 backend contract schema 中新增 actor declaration、command contract、capabilities、budgets 的解析和类型。
- [ ] 3.2 实现 validate：默认未声明 actor 时不要求 actor 文件；声明 actor 时要求命令契约和资源预算完整。
- [ ] 3.3 实现 validate/upload 对旧 hosted action 文件和 actor contract 混用的拒绝。
- [ ] 3.4 实现 actor bundle size、unsupported backend file、HTTP allowlist、capability declaration 的校验。
- [ ] 3.5 更新 CLI validate/upload/staging，使 actor 文件按声明进入版本化 payload。
- [ ] 3.6 运行 1.x 测试并确认 GREEN。
- [ ] 3.7 commit：`feat(actor): 添加 backend actor 契约校验`

## 4. GREEN: 最小 actor runtime

- [ ] 4.1 实现 actor manager：按 owner/app/version 懒加载、并发限制、空闲回收、版本切换隔离。
- [ ] 4.2 实现 actor command API surface，与 legacy `/api/actions/:name` 分离。
- [ ] 4.3 实现最小 `ctx.auth` 和 `ctx.db.query/mutate/transaction`，禁止 raw SQL 和直接 DB 文件访问。
- [ ] 4.4 实现 input validation、access check、output/result budget、超时和结构化错误码。
- [ ] 4.5 实现 actor crash/timeout/memory exceeded 后的熔断或回收，并验证 named SQL 仍可用。
- [ ] 4.6 运行 actor runtime、named SQL、hosted action disabled 回归测试。
- [ ] 4.7 commit：`feat(actor): 实现最小 backend actor runtime`

## 5. 扩展 ctx 能力和观测

- [ ] 5.1 增加 `ctx.log` / `ctx.audit`，记录 actor command 调用、用户、耗时、错误码和资源使用摘要。
- [ ] 5.2 增加 `ctx.storage` 最小能力，带 size/type/quota 校验。
- [ ] 5.3 增加 `ctx.ai` 最小能力，接入平台 AI 配置和 token/cost/timeout 审计。
- [ ] 5.4 增加可选 `ctx.http` allowlist 校验；默认关闭外网。
- [ ] 5.5 评估 `ctx.notify`、`ctx.job`、`ctx.cache` 是否进入第一版；未进入时文档标记为 future capability。
- [ ] 5.6 commit：`feat(actor): 补充受控 ctx 能力`

## 6. SDK、模板和开发者指引

- [ ] 6.1 在 SDK core 增加显式 actor command client，例如 `client.command(name, input)`，不对 named SQL 失败做 actor fallback。
- [ ] 6.2 在 SDK React 增加可选 hook，例如 `useCommand()`，返回 loading/error 并包装结构化 actor 错误。
- [ ] 6.3 更新 init-repo/CLAUDE.md 和 skills：默认推荐 named SQL，只有明确需要后端编排时才使用 actor。
- [ ] 6.4 确保默认 init 项目不包含启用的 actor contract 或 actor bundle。
- [ ] 6.5 添加最小 actor opt-in 示例，展示 `ctx.auth`、`ctx.db.transaction`、input/output contract。
- [ ] 6.6 commit：`docs(actor): 添加 SDK 和模板指引`

## 7. 验证: 真实应用和平台回归

- [ ] 7.1 构建一个最小 actor 示例应用，验证 actor command、named SQL、静态资源和正式入口同时可用。
- [ ] 7.2 选择 bug-report 或新测试应用验证 AI 结构化填报 actor，不迁移普通 CRUD 到 actor。
- [ ] 7.3 对 sample-app 保持 named SQL-first，不因 actor 能力回退到后端 actor 主路径。
- [ ] 7.4 验证 actor 崩溃/超时/内存超限后，同应用 named SQL query/mutation/transaction 仍返回 200。
- [ ] 7.5 执行平台测试：server-core、server upload/serve、SDK、init-repo、CLI e2e、OpenSpec validate。
- [ ] 7.6 构建新版 CLI；如应用侧需要同步，通知应用 session 运行 `localapp sync` 并重新验证。
- [ ] 7.7 commit：`test(actor): 验证 backend actor 应用链路`

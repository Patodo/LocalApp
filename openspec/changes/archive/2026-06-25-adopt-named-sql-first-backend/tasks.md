## 1. RED: 锁定 hosted action 禁用行为

- [x] 1.1 添加 server-core/backend contract 失败测试：包含 `backend/actions/**`、`actions.manifest.json` 或 `actions.bundle.mjs` 时 validate 必须失败，并返回 hosted actions disabled 指引。
- [x] 1.2 添加 server upload 失败测试：旧 CLI 或手工请求上传 action manifest/bundle 时不得创建新版本，当前版本保持不变。
- [x] 1.3 添加 serve action endpoint 测试：调用 `/serve/:owner/:app/api/actions/:name` 时返回稳定 `hosted_actions_disabled` 类错误，且不得加载 bundle 或创建 worker。
- [x] 1.4 添加 named SQL 回归测试：action endpoint 被拒绝后，同一应用的 registered named query 和 transaction mutation 仍可正常执行。
- [x] 1.5 执行相关失败测试并确认 RED 结果。
- [x] 1.6 commit：`test(backend): 覆盖 hosted action 禁用边界`

## 2. GREEN: 实现平台侧禁用和上传拦截

- [x] 2.1 在 server-core backend contract discovery/validation 中拒绝 hosted action source、manifest 和 bundle。
- [x] 2.2 在 CLI validate/upload 的 backend 文件校验中实现同等拒绝规则，错误文案指向 named SQL-first backend。
- [x] 2.3 在 server upload 保存 staging 前复验 action 文件禁用规则，失败时清理 staging 且不切换版本。
- [x] 2.4 在 serve action endpoint 中短路返回稳定禁用错误，避免读取 action manifest、bundle 或启动 worker。
- [x] 2.5 确保 named SQL、named mutation 和 transaction mutation 路径不依赖 hosted action runtime。
- [x] 2.6 执行 1.x 测试并确认 GREEN。
- [x] 2.7 commit：`fix(backend): 禁用 hosted action 稳定路径`

## 3. REFACTOR: 收敛 SDK、模板和开发者指引

- [x] 3.1 更新 init-repo 模板和 CLAUDE/skills 指引，删除 hosted action 示例和 fallback 建议，改为 named SQL、transaction mutation、平台原语。
- [x] 3.2 更新 SDK 文档和类型导出说明，避免将 action call 描述为稳定推荐路径；若保留 legacy helper，标注 unsupported/experimental。
- [x] 3.3 更新 `.agents/skills/localapp-app-loop` 和相关 task envelope，要求应用侧遇到 SQL 无法表达时反馈平台能力缺口，而不是创建 hosted action。
- [x] 3.4 更新 OpenSpec 主规格相关文本中 hosted action 的稳定承诺，确保归档后不再与 named SQL-first 定位冲突。
- [x] 3.5 运行模板/SDK/文档相关测试，修复因示例移除导致的断言。
- [x] 3.6 commit：`docs(backend): 收敛 named SQL-first 开发指引`

## 4. 验证: 应用迁移和平台回归

- [x] 4.1 迁移 sample-app 新导入功能，不再依赖 `workload.importWorkItems` hosted action；必要时先用 transaction mutation 或平台导入原语表达。
- [x] 4.2 对 sample-app 执行测试、build、upload，并通过正式入口 `http://localhost:3000/example-user/sample-app/` 验证导入主链路。
- [x] 4.3 对 bug-report 执行 smoke 验证，确认 named SQL-only 应用不受影响。
- [x] 4.4 执行平台测试：server-core backend contract/action 禁用测试、server upload/serve 测试、CLI e2e、OpenSpec validate。
- [x] 4.5 构建新版 CLI；如应用侧需要同步，通知应用 session 运行 `localapp sync` 并重新验证。
- [x] 4.6 commit：`test(backend): 验证 named SQL-first 应用链路`

## 1. RED：契约和上传校验测试

- [x] 1.1 在 `packages/server-core` 添加 action `uses` 白名单测试，覆盖未声明 query/mutation 被拒绝、声明项可执行、未知 SQL 在 validate 阶段报错。
- [x] 1.2 在 `packages/server-core` 添加 named query `result` contract 测试，覆盖 `page`、`single`、`aggregate`、缺失 result 的 action 引用失败。
- [x] 1.3 在 `packages/cli` 上传校验测试中添加无界 action read model 拒绝用例，包括无 `LIMIT` 列表 query、`SELECT *` 多表读取、旧 manifest 缺少 `uses`。
- [x] 1.4 在 `packages/server` 上传集成测试中添加 server 侧复验用例，确认绕过 CLI 的无效 backendFiles 不会生成新版本。
- [x] 1.5 执行 RED 阶段测试，确认新增测试先失败并记录失败点。
- [x] 1.6 提交 RED 阶段测试，commit message 遵循 commit-smart 规范。

## 2. GREEN：实现 contract 解析和 upload 拦截

- [x] 2.1 扩展 `BackendNamedSql`、`ActionManifestEntry` 类型，解析 action `type`、`uses` 和 named query `result` 元数据。
- [x] 2.2 在 `validateActionManifest` 和 backend contract 校验中强制 action `uses` 引用存在，并拒绝 action 引用无 bounded result 的 query。
- [x] 2.3 实现无界 query 静态检查：action 引用的 query 必须具备 result 元数据、平台允许的 maxRows/maxBytes，以及分页/单行/聚合约束。
- [x] 2.4 在 CLI `validate_backend_contract_files` 中实现等价轻量规则，保证 `localapp upload` 本地提前失败。
- [x] 2.5 在 server `/api/upload` 保存 staging 版本前复验 backend contract 和 action boundary，失败时清理 staging 并保持当前版本不变。
- [x] 2.6 执行 GREEN 阶段相关测试，使 1.x 新增测试通过。
- [x] 2.7 提交 GREEN 阶段实现，commit message 遵循 commit-smart 规范。

## 3. GREEN：运行时前置预算和 action ctx 收窄

- [x] 3.1 将 named query 执行从完整 `db.exec()` 物化改为可预算的逐行读取路径，超过 rows/bytes 时立即停止并返回稳定错误。
- [x] 3.2 在 action runtime RPC 处理前强制校验 action allowlist，未声明的 `ctx.query`/`ctx.mutate` 不进入数据库队列。
- [x] 3.3 在 action RPC 返回 worker 前应用 named SQL rows/bytes 预算，避免超预算结果进入 `postMessage`。
- [x] 3.4 增强 action diagnostics，记录 contract violation、SQL name、rows、bytes、budget、appKey 和稳定错误码。
- [x] 3.5 补充 WASM/sql.js 连接异常恢复测试，确认底层错误不会要求重启 server。
- [x] 3.6 执行运行时相关测试，确保 action、named SQL、transaction、预算错误均通过。
- [x] 3.7 提交运行时实现，commit message 遵循 commit-smart 规范。

## 4. REFACTOR：SDK、模板和开发者路径

- [x] 4.1 更新 `packages/backend` action 定义与构建输出，使 action manifest 带上 `type`、`uses` 和输入 schema。
- [x] 4.2 更新 builtin init 模板和 `init-repo` 示例，展示 command action、bounded named query、分页列表和聚合查询的推荐写法。
- [x] 4.3 更新 SDK/模板中的 action helper，让示例代码优先使用窄 ctx 或显式声明的 query/mutation helper。
- [x] 4.4 更新开发者文档，明确 action 不是普通读模型路径，读模型默认使用 bounded named SQL。
- [x] 4.5 执行模板和 SDK 相关测试，确认 `localapp init`、`localapp sync`、`localapp upload` 仍可用。
- [x] 4.6 提交 REFACTOR 阶段变更，commit message 遵循 commit-smart 规范。

## 5. 验证和发布准备

- [x] 5.1 执行 `pnpm -C packages/server-core test`。
- [x] 5.2 执行 `pnpm -C packages/server test`。
- [x] 5.3 执行 CLI Rust 测试或覆盖 `packages/cli` 上传校验相关测试。
- [x] 5.4 执行 `pnpm build:cli`，确认新版 CLI 可构建并输出版本。
- [x] 5.5 使用 builtin init 模板初始化临时应用，验证 bounded named SQL + command action 可以上传并运行。
- [x] 5.6 对 sample-app 兼容路径做回归，确认读模型不再依赖全量 action。
- [x] 5.7 运行 `openspec status --change constrain-hosted-backend-contract`，确认 tasks 可实施状态正确。
- [x] 5.8 提交最终验证/文档收尾，commit message 遵循 commit-smart 规范。

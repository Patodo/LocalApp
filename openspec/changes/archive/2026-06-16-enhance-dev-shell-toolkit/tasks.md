## 1. RED: 锁定 dev context 契约

- [x] 1.1 为 `init-repo/runtime/mini-server.mjs` 添加失败测试：`GET /api/dev/context` 返回默认用户 `dev-user` 和真实时间模式
- [x] 1.2 添加失败测试：`PUT /api/dev/context` 可切换到 `alice`，后续 `/api/me` 返回 `alice`
- [x] 1.3 添加失败测试：切换到未登录后，包含 `defaultFrom: "currentUser.id"` 的 create 返回未登录错误
- [x] 1.4 添加失败测试：切换用户后 `recordAccess.read` owner 策略只返回当前用户记录
- [x] 1.5 添加失败测试：固定 dev 时间后，后端 `now` 写入使用固定 ISO 时间

## 2. GREEN: 实现 mini-server dev context

- [x] 2.1 在 mini-server 中新增 dev context 数据结构、默认值、payload 校验和 `/api/dev/context` 读写端点
- [x] 2.2 将 `/api/me` 改为读取 dev context，保持默认 `dev-user` 向后兼容
- [x] 2.3 将 CRUD visitor、`applyDefaultFrom`、`recordAccess` 校验统一改为读取 dev context visitor
- [x] 2.4 增加 `resolveDevNow()`，为本地后端业务时间提供真实/固定两种模式
- [x] 2.5 运行 `pnpm -C init-repo test -- mini-server`，确认第 1 组测试通过
- [x] 2.6 REFACTOR: 整理 visitor/context helper 命名，避免在 CRUD 分支重复拼装用户对象
- [x] 2.7 提交本阶段变更，commit message 使用中文 Conventional Commits

## 3. RED: 锁定本地 transition 行为

- [x] 3.1 添加失败测试：`GET /api/{resource}/{id}/transitions` 按当前状态和 dev context visitor 返回可用 transition
- [x] 3.2 添加失败测试：`POST /api/{resource}/{id}/transitions/{name}` 成功更新状态并返回更新后记录
- [x] 3.3 添加失败测试：无权 visitor 执行 transition 返回 403 且不修改记录
- [x] 3.4 添加失败测试：transition `set` 中的 `currentUser.id` 和 `now` 分别读取 dev context 用户和固定时间
- [x] 3.5 添加 server-core 单测或调整现有测试，锁定 transition 写入支持可注入 clock

## 4. GREEN: 补齐 mini-server transition API

- [x] 4.1 调整 `packages/server-core` transition helper，让 `now` 写入支持可选 clock，生产默认真实时间
- [x] 4.2 在 mini-server 中解析 `/api/{resource}/{id}/transitions` 和 `/api/{resource}/{id}/transitions/{name}`
- [x] 4.3 复用 server-core transition 选择、access 校验和写入逻辑，避免与生产 server 分叉
- [x] 4.4 确保 transition 执行前校验 read/access/from，失败时不修改 dev.db
- [x] 4.5 运行 `pnpm -C init-repo test -- mini-server` 和相关 `packages/server-core` 测试
- [x] 4.6 REFACTOR: 将 mini-server CRUD/transition 的 schema、business、visitor 解析抽出共享 helper
- [x] 4.7 提交本阶段变更，commit message 使用中文 Conventional Commits

## 5. RED: 锁定 DevShell 工具 UI 与生产隔离

- [x] 5.1 为 DevShell 模板添加失败测试：dev shell 包含开发工具入口和身份/时间/数据/诊断分区
- [x] 5.2 添加失败测试：身份切换会调用 `/api/dev/context` 并派发 `localapp:dev-context-changed`
- [x] 5.3 添加失败测试：时间切换会写入固定 ISO 时间并支持恢复真实时间
- [x] 5.4 添加失败测试：生产构建或 vite-plugin build 模式不包含 DevShell 工具集标识
- [x] 5.5 添加失败测试：DevShell 不显示生产 nav-shell 的登录、头像、收藏、通知等入口

## 6. GREEN: 实现 DevShell 工具控制台

- [x] 6.1 在 `dev-shell.tsx` 中新增开发工具入口和分区式控制台
- [x] 6.2 实现身份切换 UI：预置用户、自定义用户、未登录，并同步 `/api/dev/context`
- [x] 6.3 实现时间切换 UI：真实时间、快捷日期、自定义 ISO，并同步 `/api/dev/context`
- [x] 6.4 在 context 更新成功后派发 `localapp:dev-context-changed`，并提供重载应用入口
- [x] 6.5 更新 DevShell 工具列表/AI tool call 展示，保留现有 getCurrentUser 与应用注册工具行为
- [x] 6.6 运行 `pnpm -C init-repo test -- dev-shell vite-plugin`
- [x] 6.7 REFACTOR: 收敛 DevShell 状态组件，保证按钮、输入和面板在窄屏不溢出
- [x] 6.8 提交本阶段变更，commit message 使用中文 Conventional Commits

## 7. RED: 锁定数据工具与诊断 API

- [x] 7.1 添加失败测试：DevShell reset 调用 mini-server 后会重建 dev.db、应用 migrations 和 dev seed
- [x] 7.2 添加失败测试：snapshot 会复制当前 dev.db 并返回 snapshot id
- [x] 7.3 添加失败测试：restore 会恢复指定 snapshot，后续 API 读取恢复后的数据
- [x] 7.4 添加失败测试：mini-server 记录最近请求 method、path、status、duration 和截断 body
- [x] 7.5 添加失败测试：DevShell 展示 manifest business 配置和最近请求诊断

## 8. GREEN: 实现数据工具与诊断

- [x] 8.1 在 mini-server 中新增 dev data reset/snapshot/restore API，并限制在 `.localapp/` 下操作
- [x] 8.2 reset 时安全关闭 SQLite 连接，重建 dev.db 后重新应用 migrations 和 `db/seeds/dev.sql`
- [x] 8.3 snapshot/restore 使用 `.localapp/dev-snapshots/`，返回可读 id 和创建时间
- [x] 8.4 增加 mini-server 请求诊断 ring buffer，限制条数并截断 body 摘要
- [x] 8.5 DevShell 数据分区接入 reset/snapshot/restore，诊断分区展示最近请求
- [x] 8.6 DevShell 业务规则分区读取 manifest business 信息并展示 `recordAccess`、`defaultFields`、`transitions`、`enums`
- [x] 8.7 运行 `pnpm -C init-repo test -- mini-server dev-shell`
- [x] 8.8 REFACTOR: 将危险数据操作的确认文案和错误提示统一
- [x] 8.9 提交本阶段变更，commit message 使用中文 Conventional Commits

## 9. SDK 与文档同步

- [x] 9.1 添加失败测试：SDK 数据 hooks 在收到 `localapp:dev-context-changed` 后触发 invalidate 或刷新
- [x] 9.2 实现 SDK dev context 事件监听，确保不影响生产默认业务 API
- [x] 9.3 更新 `init-repo/CLAUDE.md` 和相关 skills，说明如何用 DevShell 验证身份、时间、recordAccess 和 transitions
- [x] 9.4 运行 `pnpm -C init-repo test` 和相关 `packages/sdk-react` 测试
- [x] 9.5 REFACTOR: 删除临时测试辅助和重复文档段落
- [x] 9.6 提交本阶段变更，commit message 使用中文 Conventional Commits

## 10. 最终验证

- [x] 10.1 运行 `pnpm -C init-repo test`
- [x] 10.2 运行 `cargo test --package localapp`（如 CLI/dev-config 有改动）
- [x] 10.3 运行 `npx openspec validate enhance-dev-shell-toolkit --strict`
- [x] 10.4 执行一次本地 smoke：`localapp dev` 启动后切换用户、固定时间、创建记录、执行 transition、reset/restore dev.db
- [x] 10.5 检查生产 build 产物不包含 DevShell 工具集和 `/api/dev/*` 标识
- [x] 10.6 更新 tasks 完成状态并准备归档/合入前 review

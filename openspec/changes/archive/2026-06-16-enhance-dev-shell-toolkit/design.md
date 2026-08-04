## Context

当前 `localapp dev` 会启动 mini-server，并由 vite-plugin 将应用层 `/api/*` 请求分流到本地 SQLite。这个隔离已经解决了“开发时误写生产数据”的问题，但 DevShell 仍缺少开发控制能力：

- mini-server 的 `/api/me` 和 CRUD visitor 固定为 `dev-user`，无法验证 owner、assignee、ACL、未登录等场景。
- `transition` 业务流转依赖 `currentUser.*` 和 `now`，但 dev 环境缺少统一的用户/时间上下文，也尚未补齐本地 transition 端点。
- 开发者需要反复 reset 数据、构造记录、观察请求和工具调用，目前只能手动改数据库或猜测后端行为。

这个变更跨越 DevShell UI、mini-server、vite-plugin、server-core 和模板测试，因此需要先明确共享上下文与隔离边界。

## Goals / Non-Goals

**Goals:**

- 让开发者在 DevShell 中切换当前用户、未登录状态和当前时间，并让本地 API 立即按该上下文执行。
- mini-server 统一读取 dev context，用于 `/api/me`、CRUD、`defaultFrom`、`recordAccess`、transition access 和 transition `set`。
- 在 dev 模式补齐 transition API，使 `useTransitions()` 可以完整验证审批、提交、完成等业务流。
- 提供本地数据 reset/snapshot/restore 和请求诊断，帮助开发者快速复现状态。
- 保持生产隔离：DevShell 工具和 `/api/dev/*` 只存在于 `localapp dev` 的本地 mini-server 中。

**Non-Goals:**

- 不把这些工具上传到生产产物，不在生产 server 暴露 `/api/dev/*`。
- 不实现真实多用户登录会话；dev 用户是本地模拟身份，用于业务规则验证。
- 不 monkey-patch 全局 `Date`。前端纯客户端日期逻辑若直接调用 `new Date()`，需要通过 SDK/DevShell 提供的 dev context 明确接入。
- 不在第一版实现复杂数据编辑器；表数据浏览与 reset/snapshot 以可验证、低风险为先。

## Decisions

### 1. dev context 由 mini-server 持有

DevShell 通过 `/api/dev/context` 读取和更新上下文，mini-server 在内存中持有当前 context，并把它作为所有本地业务 API 的事实来源。

默认 context：

```json
{
  "user": { "id": "dev-user", "name": "Dev User", "role": "owner" },
  "now": null,
  "timeMode": "real"
}
```

`user: null` 表示未登录。`now: null` 表示使用真实系统时间。

选择原因：

- mini-server 已经是 dev API 的唯一后端，放在这里能保证 `/api/me`、CRUD、transition 的行为一致。
- DevShell 只负责控制与展示，不需要把权限逻辑复制到前端。
- 未来 CLI 或测试也可以直接调用 `/api/dev/context` 设置场景。

备选方案：

- 只在 DevShell 前端存用户和时间：无法影响后端 `recordAccess`、`defaultFrom` 和 transition，价值很低。
- 通过 cookie 模拟登录：会把 dev-only 状态与生产 auth 模型混在一起，复杂且容易误导。

### 2. 用户切换覆盖后端 visitor 语义

mini-server 新增 `getDevVisitor(context)`：

- `context.user === null` 时 visitor 为未登录。
- 有用户时 visitor 使用 `{ id, name, role }`。
- `/api/me` 返回与生产一致的 `{ success, data }` 包装；未登录返回 401 或 `data: null` 的行为需与现有 SDK 期待保持一致。
- CRUD、`defaultFrom`、`recordAccess`、transition access 都使用同一个 visitor。

预置用户只用于便利：

- `dev-user` / `Dev User`
- `alice` / `Alice`
- `bob` / `Bob`
- `admin` / `Admin`
- `未登录`

DevShell 允许输入自定义 id/name，以验证任意 owner/assignee/ACL 字段。

### 3. 时间切换使用可注入 clock，不替换全局 Date

mini-server 新增 `resolveDevNow(context)`：

- `timeMode: "real"` 使用 `new Date()`。
- `timeMode: "fixed"` 使用 context 中的 ISO 时间。

server-core 的 transition 写入逻辑如果目前直接调用 `new Date().toISOString()`，应改为接受可选 `now?: () => string`，生产 server 默认真实时间，mini-server 注入 `resolveDevNow`。

原因：

- 后端业务字段 `set: "now"` 必须可测试。
- 不替换全局 `Date` 可以避免第三方组件、动画、缓存和测试框架受到副作用。
- 前端若需要显示“开发当前时间”，通过 DevShell context 或 SDK hook 明确读取。

### 4. mini-server 补齐 transition API

mini-server 应实现：

- `GET /api/{resource}/{id}/transitions`
- `POST /api/{resource}/{id}/transitions/{name}`

逻辑复用 `server-core` 的 transition helpers，与生产 server 的行为保持一致：

- 读取当前记录。
- 校验 read 权限。
- 列出当前状态与 access 允许的 transitions。
- 执行时校验 transition 名称、from 状态、access。
- 应用 `set`，其中 `currentUser.*` 和 `now` 使用 dev context。
- 更新记录并返回更新后的行。

这会让 DevShell 身份和时间切换真正覆盖审批/流程类应用的主路径。

### 5. DevShell 工具分区

DevShell 顶部保持当前轻量 nav，但增加一个开发工具入口，工具面板按分区组织：

- 身份：当前用户、预置用户、自定义用户、未登录。
- 时间：真实时间、固定时间、快捷跳转今天/明天/下周/月末、自定义 ISO。
- 数据：reset dev.db、保存 snapshot、恢复 snapshot、列出表和行数。
- 业务规则：展示 manifest.business 中当前表的 `recordAccess`、`defaultFields`、`transitions`、`enums`，并可对选中记录解释当前用户可执行动作。
- 诊断：最近请求、状态码、耗时、缓存命中、AI tool call 历史。

UI 改动应继续遵守 DevShell 是开发工具层的定位，不复制生产 nav-shell 的头像、收藏、登录等用户入口。

### 6. context 变化后的刷新策略

身份或时间变化后，DevShell SHALL 触发应用数据刷新。第一版采用保守策略：

- DevShell 更新 context 成功后，发送自定义事件 `localapp:dev-context-changed`。
- SDK hooks 后续可监听事件并 invalidate；若未接入，则 DevShell 提供“重载应用”按钮或自动刷新当前页面。

实现时优先让 `sdk-react` 的数据 hooks 监听该事件并调用现有 invalidate 机制，减少开发者手动刷新。

## Risks / Trade-offs

- [Risk] dev 用户与生产用户模型不完全一致，开发者可能误以为它是真实登录。→ Mitigation: UI 明确标注为“模拟身份”，并且只在 DevShell 中出现。
- [Risk] 时间切换无法影响应用中直接调用 `new Date()` 的纯前端逻辑。→ Mitigation: 文档和 SDK 提供 `useDevContext`/事件；后端业务时间先保证一致。
- [Risk] reset/snapshot 可能误删本地开发数据。→ Mitigation: 操作只作用于 `.localapp/dev.db`，UI 使用明确确认；snapshot 存在 `.localapp/dev-snapshots/`。
- [Risk] 请求诊断记录请求体可能包含敏感信息。→ Mitigation: 仅 dev 本地内存保存，限制条数，默认截断 body，并不写入生产日志。
- [Risk] transition 逻辑在 mini-server 与生产 server 分叉。→ Mitigation: 尽量复用 `server-core` helper，新增共享测试覆盖 `currentUser`、`now`、access 和 from 状态。

## Migration Plan

1. 在 mini-server 增加 dev context 默认值，保持不操作工具时仍返回 `dev-user` 与真实时间。
2. 补齐 transition API 与可注入 clock，先用测试锁定与生产语义一致。
3. 增加 DevShell 控制台 UI，并接入 `/api/dev/context`。
4. 增加 reset/snapshot/诊断 API，全部限定在 mini-server。
5. 更新模板文档和测试。

回滚策略：移除 DevShell 工具入口和 `/api/dev/*` 后，mini-server 可回到默认 `dev-user` 行为；生产 server 不受影响。

## Open Questions

- `/api/me` 在 dev 未登录时应返回 401 还是 `{ success: true, data: null }`？实现前需与 `sdk-core`、`sdk-agent` 当前兼容路径对齐。
- 第一版表数据浏览是否允许编辑单行，还是只展示行数和最近记录？建议先不做编辑，避免绕过业务 API。
- SDK 是否新增公开 `useDevContext`，还是把 dev context 仅作为 DevShell 内部事件？建议先事件化，公开 API 等使用场景稳定后再加。

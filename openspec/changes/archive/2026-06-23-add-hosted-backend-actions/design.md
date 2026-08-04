## Context

LocalApp 当前已经将应用数据通道收敛到 named SQL：前端不能提交任意 SQL，只能调用应用发布时注册的 query/mutation。这解决了“前端直接操纵数据库”的大问题，但仍没有承载复杂业务逻辑的服务端层。审批、跨表编排、通知、事务、保密规则等逻辑如果继续放在 React 或 SQL 中，会削弱平台作为后端边界的可信度。

本设计引入平台托管 backend actions。应用不自建 HTTP server，也不监听端口；应用只提供 action 定义，由 LocalApp server 在受限 runtime 中加载并执行。平台负责鉴权、输入校验、上下文注入、日志、错误格式、超时和与现有 named SQL/通知/文件能力的连接。

## Goals / Non-Goals

**Goals:**

- 提供 `defineAction({ input, access, handler })` 的服务端业务函数模型。
- 提供 `/serve/:owner/:app/api/actions/:name` 与 `client.action(name, input)` 调用链路。
- 在 action handler 中注入受限 `ctx`，包含 `user`、`query`、`mutate`、`transaction`、`notify`、`log` 等平台能力。
- 复用现有 backend contract、named SQL、访问控制、上传版本化和本地 mini-server 架构。
- 让生产 server 和 dev mini-server 拥有一致的 action 表面。

**Non-Goals:**

- 不允许应用自建后端服务、监听端口或注册任意 HTTP 路由。
- 第一版不支持任意外部网络请求、任意文件系统访问、cron、队列、长任务或 WebSocket 自定义协议。
- 第一版不把 action 设计成插件系统，不允许直接 import 平台内部私有模块。
- 第一版不承诺强沙箱安全等同多租户云隔离；运行时边界应作为平台 API 边界，而不是恶意代码隔离的最终方案。

## Decisions

### Decision: 直接引入 ctx backend action，而不是先做 JSON workflow

平台 SHALL 支持由应用声明的 TypeScript/JavaScript action。JSON workflow 虽然更易审计，但表达力会迅速不足，并可能成为过渡技术债。直接提供 `ctx` 模型可以覆盖复杂业务逻辑，同时通过受限 API 维持平台边界。

替代方案：先做声明式 workflow。放弃原因是它难以表达复杂分支、复用、错误处理和未来扩展，最终仍需要 action runtime。

### Decision: action 是平台托管函数，不是应用后端服务

action bundle SHALL 随应用版本上传并由平台 server 加载。应用不得提供进程、端口或独立服务。所有请求仍进入 LocalApp server 的 `/serve/:owner/:app/api/actions/:name`。

替代方案：外部 webhook 或函数 provider。放弃作为默认路径，因为这会把鉴权、部署、日志和 SLA 分散到应用外部，破坏平台一致性。

### Decision: action 只能通过 ctx 使用平台能力

action handler SHALL 接收平台构造的 `ctx`。`ctx.query` 与 `ctx.mutate` 复用 named SQL 执行器；`ctx.user` 来自 server session/API key；`ctx.notify` 复用平台通知能力；`ctx.log` 进入平台请求日志。action 不应直接访问数据库文件、meta db、文件系统或 HTTP server 实例。

替代方案：允许 action import server-core 并直接调用内部函数。放弃原因是会把平台私有实现暴露成公共 ABI，后续重构成本过高。

### Decision: 第一版使用构建产物 + manifest 加载

CLI 在 validate/upload 时 SHALL 构建 actions bundle，并生成 `actions.manifest.json`。server 只加载构建产物，不在生产请求时编译 TypeScript。manifest 记录 action 名称、访问等级、输入 schema 摘要和 bundle entry。

替代方案：生产 server 直接执行源码或即时编译。放弃原因是请求路径成本和错误面更大，也更难保证上传时已经发现问题。

### Decision: 初始 runtime 用 Node 隔离边界，保留未来替换空间

第一版 MAY 使用 worker thread、`vm` 或动态 import 的受控 loader 执行 action bundle，但公共契约 SHALL 只暴露 `@localapp/backend` 的 `defineAction` 与 `ctx` 类型。未来可迁移到 V8 isolate、独立进程或更强沙箱，而不改变应用代码。

### Decision: 事务先围绕平台数据库能力定义

`ctx.transaction(fn)` SHALL 提供应用数据库写入的原子边界。第一版可先约束为同一 app SQLite 连接内的 named SQL 事务；跨通知、外部副作用等不得承诺回滚。

## Risks / Trade-offs

- [Risk] JS runtime 隔离不足，恶意 action 可能尝试访问 Node 能力 → Mitigation: 第一版限制为本地/可信应用模型，禁止公开承诺强多租户隔离；runtime loader 明确限制 import，并为后续 isolate/进程隔离预留接口。
- [Risk] action 与 named SQL 双层抽象增加开发复杂度 → Mitigation: init template 提供清晰示例，SDK 保持 `client.action()` 单入口，常见 CRUD 仍可继续用 named SQL。
- [Risk] action bundle 构建增加 CLI/upload 复杂度 → Mitigation: 构建失败在 upload 前暴露，manifest 使用显式文件，server 不承担 TypeScript 编译。
- [Risk] dev mini-server 与生产 server 行为漂移 → Mitigation: 将 action manifest 解析、ctx 构建和 action API contract 放入共享 server-core，dev/prod 只提供不同的用户上下文和存储路径。
- [Risk] action handler 中的副作用事务语义容易被误解 → Mitigation: 规格明确 `ctx.transaction` 仅覆盖数据库操作，通知等副作用在事务外或采用 afterCommit 语义。

## Migration Plan

1. 新增 action contract 和 `@localapp/backend` 类型/运行时入口，不影响现有 named SQL 应用。
2. CLI validate/upload 支持发现并构建 actions；未声明 actions 的应用保持现有流程。
3. server 版本化保存 action bundle，并在 `/serve/:owner/:app/api/actions/:name` 上按 manifest 加载执行。
4. SDK 新增 `client.action()`，现有 query/mutate/list/create 等 API 保持兼容。
5. init template 增加示例 action 和文档；mini-server 实现同等 endpoint 供 dev 调试。

回滚策略：如果 action runtime 出现问题，应用可删除 backend actions 并继续使用 named SQL；server 对无 action manifest 的旧应用保持现有行为。

## Open Questions

- 第一版 runtime 采用 worker thread、`vm.SourceTextModule` 还是受控 dynamic import，需要在实施 spike 中以测试和安全边界决定。
- 输入 schema 使用 Zod 源码、JSON Schema 产物，还是由 `defineAction` 构建时导出，需要在构建方案中定稿。
- 是否需要为 action 增加显式 `timeoutMs` 与 `audit` 配置，第一版可使用平台默认值。

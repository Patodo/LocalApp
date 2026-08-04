## Why

当前平台已经通过 named SQL 避免了前端直接提交任意 SQL，但复杂业务逻辑仍容易被迫放在前端或塞进 SQL。为了让 LocalApp 能承载更接近传统 B/S 应用的安全业务流程，需要提供由平台托管执行的服务端 action runtime，让应用声明业务函数而不是自建后端服务。

## What Changes

- 新增平台托管 backend actions 能力：应用可声明 `backend/actions` 中的 server-side action，并通过平台统一执行。
- 新增 `defineAction({ input, access, handler })` 编程模型，handler 只能通过受限 `ctx` 使用平台能力。
- 新增 `/serve/:owner/:app/api/actions/:name` 调用入口，并由 server 负责鉴权、参数校验、日志、错误格式和执行超时。
- 新增 SDK `client.action(name, input)`，前端通过 action 名称调用服务端业务逻辑。
- 扩展 CLI validate/upload/build 流程，发现、校验、构建并上传 action bundle 与 action manifest。
- 扩展 init template 与本地 mini-server，让开发者可以在应用开发阶段编写和调试 actions。
- 不引入应用自建 HTTP server、监听端口或任意后端进程；应用只提交受平台托管的 action 代码。

## Capabilities

### New Capabilities

- `hosted-backend-actions`: 定义平台托管服务端 action 的契约、调用入口、运行时边界、`ctx` 能力和安全限制。

### Modified Capabilities

- `backend-contract-files`: backend 契约目录需要支持 action 源码、action manifest 和构建产物的发现、校验与打包规则。
- `client-sdk`: SDK 需要新增 `client.action()` 以及对应错误处理和 basePath 行为。
- `cli-tool`: CLI 需要在 validate/upload 流程中构建、校验并上传 backend actions。
- `init-template`: 初始化模板需要包含 backend action 开发约定、示例和类型入口。
- `local-mini-server`: 本地开发服务需要支持 action endpoint，尽量模拟生产平台执行语义。

## Impact

- 影响 server 的 `/serve/:owner/:app/api/*` 路由、backend contract loader、上传解包和版本化存储。
- 影响 server-core 的契约解析、action manifest 校验、受限 runtime、`ctx` API 和错误模型。
- 影响 SDK 的类型定义、客户端请求封装和 React 应用调用方式。
- 影响 CLI 的 validate/upload 构建链路，可能需要引入 action bundling 工具或复用现有前端构建能力。
- 影响 init-repo 模板、开发文档、测试夹具和端到端测试流程。

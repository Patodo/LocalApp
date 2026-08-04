## 1. RED：契约与运行时测试先行

- [x] 1.1 为 `packages/server-core` 增加 action manifest 解析测试，覆盖 action 名称唯一、access 合法、input schema 可序列化、未知 named SQL 引用失败
- [x] 1.2 为 action runtime 增加 ctx 构造测试，覆盖 `ctx.user`、`ctx.query`、`ctx.mutate`、`ctx.transaction`、`ctx.notify`、`ctx.log` 的可见行为
- [x] 1.3 为生产 server 增加 `/serve/:owner/:app/api/actions/:name` 集成测试，覆盖成功执行、404 未注册、401 未登录、403 owner/acl 拒绝、400 输入错误
- [x] 1.4 为 SDK 增加 `client.action()` 和 `useAction()` 单元测试，覆盖 basePath、请求体、成功返回、LocalAppError
- [x] 1.5 为 CLI/upload 增加 action 构建与校验失败测试，覆盖合法 action 进入 payload、TypeScript/action contract 错误阻止上传
- [x] 1.6 为 init template 与 mini-server 增加 dev action 测试，覆盖 `localapp dev` 下 `/api/actions/:name` 使用 dev context 执行
- [x] 1.7 执行相关测试并确认新增测试先失败
- [x] 1.8 commit：`test(actions): 覆盖托管后端函数契约`

## 2. GREEN：实现 backend action contract 与 runtime

- [x] 2.1 在 `packages/server-core` 增加 action 类型、manifest schema、loader 和 validate 逻辑
- [x] 2.2 增加 `@localapp/backend` 的 `defineAction`、输入 schema 辅助类型和 action 导出约定
- [x] 2.3 实现受限 action runtime 最小版本，支持加载当前版本 bundle 并执行 handler
- [x] 2.4 实现 action ctx，复用 named SQL 执行器提供 `ctx.query` 和 `ctx.mutate`
- [x] 2.5 实现 `ctx.transaction` 的同一 app SQLite 事务边界，并明确副作用不自动回滚
- [x] 2.6 实现 `ctx.notify` 和 `ctx.log` 的第一版平台适配
- [x] 2.7 执行 `packages/server-core` 相关测试并通过
- [x] 2.8 commit：`feat(actions): 实现托管后端函数运行时`

## 3. GREEN：接入生产 server 与版本化上传

- [x] 3.1 在生产 serve 路由中注册 `/serve/:owner/:app/api/actions/:name`，并确保分流优先级不影响 named SQL、content、notify
- [x] 3.2 在 upload 解包与版本化存储中保存 `actions.manifest.json` 和 action bundle
- [x] 3.3 在生产 action endpoint 中接入 page access、action access、input validation、标准错误格式和请求日志
- [x] 3.4 确保 action endpoint 使用当前版本应用目录加载 contract，不读取旧版本或项目根临时文件
- [x] 3.5 执行 server action 集成测试并通过
- [x] 3.6 commit：`feat(server): 接入应用后端 action 端点`

## 4. GREEN：接入 CLI、SDK、模板与 mini-server

- [x] 4.1 扩展 CLI validate/upload 构建链路，发现 backend actions、构建 bundle、生成 manifest 并加入 multipart payload
- [x] 4.2 扩展 SDK core，新增 `client.action()` 并复用现有 `LocalAppError`、basePath 和响应解析
- [x] 4.3 扩展 SDK react，新增 `useAction()` Hook
- [x] 4.4 更新 init template，增加 backend action 示例、`@localapp/backend` 类型入口、CLAUDE.md 指南和前端调用示例
- [x] 4.5 扩展 local mini-server，共享 action contract 并实现 `/api/actions/:name`
- [x] 4.6 执行 CLI、SDK、init template、mini-server 相关测试并通过
- [x] 4.7 commit：`feat(actions): 打通开发与上传链路`

## 5. REFACTOR：收敛边界与文档

- [x] 5.1 将 dev/prod 共用的 action API 识别、manifest 校验、ctx 类型和错误映射收敛到共享模块
- [x] 5.2 清理 action runtime 与 named SQL runtime 的重复校验逻辑，保持安全检查只有一个权威实现
- [x] 5.3 补充开发文档，明确 action 不是自建后端、不支持任意网络/文件系统/端口/长任务
- [x] 5.4 更新示例应用，展示审批类业务逻辑从前端迁移到 backend action
- [x] 5.5 执行格式化、类型检查和相关单元测试
- [x] 5.6 commit：`refactor(actions): 收敛托管函数平台边界`

## 6. 验证：端到端与回归

- [x] 6.1 执行 `openspec validate add-hosted-backend-actions --strict`
- [x] 6.2 执行 server-core、server、SDK、CLI、init template 的相关测试套件
- [x] 6.3 使用 `localapp init` 创建测试应用，编写一个带 action 的请假审批示例
- [x] 6.4 在 dev 模式验证 `client.action()` 可调用 mini-server action，并使用 dev context 切换用户
- [x] 6.5 上传测试应用到生产 server，访问 `/serve/:owner/:app/api/actions/:name` 验证鉴权、输入校验和 named SQL 副作用
- [x] 6.6 验证旧的纯 named SQL 应用无需 action manifest 仍可正常上传和访问
- [x] 6.7 commit：`chore(actions): 完成托管后端函数方案`

## Why

LocalApp 已经将稳定主路线收敛为 named SQL-first，但复杂应用仍会遇到 SQL 和 transaction mutation 难以表达的后端编排需求，例如 AI 调用、复杂导入、跨多个平台原语的可信命令和长一点的校验流程。直接恢复旧 hosted action 会重新引入 worker/VM 不稳定和任意后端扩张风险，因此需要一个更窄、更可控的可选后端模型。

本变更探索并定义 App Backend Actor：默认应用仍使用 named SQL；只有显式声明需要后端的应用才获得一个按应用/版本托管、资源受限、通过 `ctx` 调用平台能力的后端编排单元。

## What Changes

- 新增可选 App Backend Actor 能力，用于承载复杂应用的受控后端编排。
- 应用必须在 manifest/backend contract 中显式声明 backend actor，默认不创建 actor。
- actor 只能通过平台提供的 `ctx` 能力访问身份、named SQL、transaction、storage、AI、通知、受限 HTTP、日志和审计。
- actor 不得直接监听端口、直接访问 SQLite 文件、任意读写文件系统、默认访问外网或绕过平台权限。
- actor 生命周期从“每次请求临时 worker”改为“按 app/version 懒加载、空闲回收、资源预算约束”的模型。
- upload/validate 阶段必须预检 actor bundle、能力声明、权限声明、输入输出契约和资源预算。
- 旧 hosted action 仍保持禁用；App Backend Actor 是新稳定能力候选，不是恢复旧 action runtime。

## Capabilities

### New Capabilities
- `app-backend-actors`: 定义显式声明的应用后端 actor，包括生命周期、ctx 能力、沙箱边界、资源预算、上传预检、调用语义和诊断要求。

### Modified Capabilities
- `hosted-backend-actions`: 继续禁用旧 hosted action，并定义它与 App Backend Actor 的迁移/区分关系。
- `backend-contract-files`: 增加 actor manifest/contract 的声明、校验和打包边界。
- `client-sdk`: 增加调用 backend actor command 的 SDK 形态，同时保持 named SQL API 为默认推荐。
- `init-template`: 增加“何时需要 actor、何时不需要 actor”的开发指引和最小示例。

## Impact

- 影响 server backend runtime 设计、serve API、upload/validate、CLI build/upload、SDK、init-repo 模板和应用协作 skill。
- 需要新增 actor lifecycle manager、资源限制、ctx API、manifest/schema 校验、错误包装和审计日志。
- 需要重新评估依赖和运行时选型，例如 Node worker_threads、isolated-vm、workerd 或进程级 sandbox，但实现前必须先完成设计 gate。
- 需要用 sample-app 或新的复杂应用作为验证样板，证明 actor 不会破坏 named SQL-first 稳定性。

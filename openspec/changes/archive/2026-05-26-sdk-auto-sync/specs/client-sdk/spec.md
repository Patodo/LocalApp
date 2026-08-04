## MODIFIED Requirements

### Requirement: SDK 包结构

`init-repo/src/lib/localapp/` SHALL 作为 SDK 的唯一源码位置，包含 `client.ts`（底层 HTTP 客户端）、`react.ts`（React Hook）、`index.ts`（统一导出）、`types.ts`（类型定义）。`packages/client/` 包 SHALL 被移除。运行时依赖仅 `react`（peerDependency）和浏览器内置 `fetch`。

`client.ts` SHALL 定义 `LocalAppError` 类继承 `Error`，携带 `status: number` 字段。`request()` 函数在非 2xx 响应时 SHALL 抛出 `LocalAppError` 而非 `Error`。

`index.ts` SHALL 额外导出 `LocalAppError` 类和 `redirectToLogin` 函数。

#### Scenario: 包结构验证
- **WHEN** 查看 `init-repo/src/lib/localapp/` 目录
- **THEN** 包含 `client.ts`、`react.ts`、`index.ts`、`types.ts`

#### Scenario: packages/client 不存在
- **WHEN** 查看 `packages/` 目录
- **THEN** 不包含 `client` 子目录

#### Scenario: 零运行时依赖
- **WHEN** 查看 `init-repo/package.json`
- **THEN** SDK 相关代码无额外 npm 依赖，仅使用 react 和浏览器内置 API

#### Scenario: LocalAppError 导出
- **WHEN** 从 `./lib/localapp` 导入 `LocalAppError`
- **THEN** `LocalAppError` 是 `Error` 的子类，构造函数接受 `message: string` 和 `status: number`

#### Scenario: redirectToLogin 导出
- **WHEN** 从 `./lib/localapp` 导入 `redirectToLogin`
- **THEN** 它是一个无参数函数，调用后将外层窗口跳转到 `/login?redirect=...`

### Requirement: SDK 测试位置

SDK 单元测试 SHALL 位于 `init-repo/src/lib/localapp/__tests__/` 目录，使用 init-repo 已有的 vitest 环境。测试 SHALL 覆盖 client、react hooks、mutations、redirect 等功能。

#### Scenario: 测试文件存在
- **WHEN** 查看 `init-repo/src/lib/localapp/__tests__/` 目录
- **THEN** 包含 `client.test.ts`、`react.test.ts`、`mutations.test.ts`、`redirect.test.ts`

#### Scenario: 测试可运行
- **WHEN** 在 `init-repo/` 目录执行 `npm test`
- **THEN** 所有 SDK 测试通过

## REMOVED Requirements

### Requirement: SDK 同步脚本
**Reason**: SDK 源码统一到 init-repo，不再需要从 packages/client 同步到 init-repo 的脚本
**Migration**: SDK 开发直接在 init-repo/src/lib/localapp/ 中进行，无需同步步骤

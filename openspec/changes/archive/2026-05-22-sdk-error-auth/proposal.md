## Why

SDK 的 query hooks（`useMe`、`useList`、`useGet`、`useCount`）在 API 请求失败时没有错误处理——Promise rejection 未捕获，`loading` 状态永远卡在 `true`，应用 UI 无响应。同时，应用无法检测"用户未登录"（401）和引导用户去登录——SDK 缺少任何认证交互能力。

这对目标用户（不懂代码、靠 AI 助手开发的人）尤其致命：他们看不到系统代码，只能依赖 SDK 暴露的接口来构建应用。如果 SDK 不提供 error 状态和登录跳转，AI 助手也无法替他们写出正确的错误处理逻辑。

## What Changes

- 所有 query hooks 新增 `error` 返回字段，类型为 `LocalAppError | null`（含 HTTP status code），请求失败时 `loading` 正常归位为 `false`
- 新增 `LocalAppError` 错误类，携带 `status` 字段，让应用能区分 401（未登录）、403（无权限）等
- 新增 `redirectToLogin()` 工具函数，将外层平台 shell（而非 iframe 自身）跳转到登录页，登录后自动回到当前页
- 更新 `CLAUDE.md`，补充 error 处理和 auth 跳转的使用示例，确保 AI 助手能正确引导用户

## Capabilities

### New Capabilities

无

### Modified Capabilities

- `client-sdk`: query hooks 新增 error 状态；新增 LocalAppError 类和 redirectToLogin 工具函数
- `init-template`: CLAUDE.md 补充 error 处理和 auth 跳转的使用文档

## Impact

- `packages/client/src/client.ts` — 新增 `LocalAppError` 类，`request()` 抛出 `LocalAppError` 而非 `Error`
- `packages/client/src/react.ts` — 4 个 query hooks 加 `.catch()` + `error` 状态
- `packages/client/src/index.ts` — 导出 `LocalAppError` 和 `redirectToLogin`
- `init-repo/CLAUDE.md` — 补充 error/auth 使用文档
- 现有测试需适配新的 error 类型
- 无破坏性变更：新增字段不影响现有解构 `{ rows, loading }` 继续工作

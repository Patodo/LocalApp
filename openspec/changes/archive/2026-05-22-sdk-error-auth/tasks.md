## 1. LocalAppError 错误类

- [x] 1.1 [RED] 编写 LocalAppError 和 request() 抛出行为的单元测试
- [x] 1.2 [GREEN] 在 `client.ts` 中实现 `LocalAppError` 类，修改 `request()` 抛出 `LocalAppError`
- [x] 1.3 [REFACTOR] 检查现有测试是否需要适配（将 `expect(e).toBeInstanceOf(Error)` 改为 `LocalAppError` 等）
- [x] 1.4 在 `index.ts` 中导出 `LocalAppError` 和 `redirectToLogin`
- [x] 1.5 commit: `feat(client): 添加 LocalAppError 和 redirectToLogin`

## 2. Query Hooks error 状态

- [x] 2.1 [RED] 为 useMe、useList、useGet、useCount 编写 error 状态的单元测试（401/403/网络错误 → error 非空，loading 归位 false）
- [x] 2.2 [GREEN] 修改 `react.ts` 中 4 个 query hooks：添加 error state，useEffect 中 try/catch 包裹，finally 中 setLoading(false)
- [x] 2.3 [REFACTOR] 检查现有 hook 测试是否需要适配（返回类型新增 error 字段）
- [x] 2.4 commit: `feat(client): query hooks 添加 error 状态`

## 3. redirectToLogin 工具函数

- [x] 3.1 [RED] 编写 redirectToLogin 的单元测试（iframe 场景修改 parent.location，非 iframe 场景修改 window.location）
- [x] 3.2 [GREEN] 在 `client.ts` 中实现 `redirectToLogin`，通过 `index.ts` 导出
- [x] 3.3 commit: `feat(client): 添加 redirectToLogin 登录跳转工具`

## 4. SDK 同步 + CLAUDE.md 更新

- [x] 4.1 执行 `pnpm sync:sdk` 将更新后的 SDK 源码同步到 `init-repo/src/lib/localapp/`
- [x] 4.2 更新 `init-repo/CLAUDE.md`：补充 error 处理和 redirectToLogin 的使用文档与示例代码
- [x] 4.3 commit: `docs(init-template): CLAUDE.md 补充 error 处理和登录跳转指南`

## 5. E2E 测试

| Spec Scenario | E2E Test | Status |
|---|---|---|
| client-sdk > Scenario: LocalAppError 导出 | 验证 LocalAppError 继承 Error 且 status 可用 | ✓ |
| client-sdk > Scenario: redirectToLogin 导出 | 验证 redirectToLogin 是函数 | ✓ |
| client-sdk > Scenario: iframe 内调用 | 验证 redirectToLogin 设置 parent.location | ✓ |
| init-template > Scenario: CLAUDE.md 包含错误处理说明 | 验证 CLAUDE.md 包含 LocalAppError 和 error.status | ✓ |
| init-template > Scenario: CLAUDE.md 包含登录跳转说明 | 验证 CLAUDE.md 包含 redirectToLogin | ✓ |

- [x] 5.1 [GREEN] 为 client-sdk > Scenario: LocalAppError/redirectToLogin 编写 e2e 测试
- [x] 5.2 [GREEN] 为 init-template > Scenario: CLAUDE.md error/auth 编写 e2e 测试
- [x] 5.3 执行全部 e2e 测试，验证通过
- [x] 5.4 更新映射表中所有 Status 为 ✓
- [x] 5.5 commit: `test(e2e): 添加 sdk-error-auth e2e 测试`

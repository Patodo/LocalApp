## Context

SDK（`packages/client`）当前有 7 个 hooks 和一个底层 HTTP 客户端。query hooks（`useMe`、`useList`、`useGet`、`useCount`）在 useEffect 中发起请求但未 catch 错误——请求失败时 Promise rejection 无人处理，`loading` 永远为 `true`。应用开发者无法得知失败原因，也无法区分"未登录"和"无权限"。

应用运行在平台的 iframe（`sandbox="allow-scripts allow-forms allow-same-origin"`）中。平台 shell 在顶部导航栏提供 Login/Register/Logout 链接，但 iframe 内的应用无法主动触发登录跳转。

目标用户不懂代码，依赖 AI 助手 + CLAUDE.md 指南开发应用。SDK 必须提供足够的信息和工具，让 AI 助手能生成正确的错误处理逻辑。

## Goals / Non-Goals

**Goals:**
- query hooks 暴露 error 状态，请求失败时 loading 正常归位
- error 携带 HTTP status code，应用能区分 401/403/其他
- 提供登录跳转工具函数，iframe 能将外层 shell 跳转到登录页
- 更新 CLAUDE.md，补充 error 和 auth 的使用指南

**Non-Goals:**
- 不实现自动重试机制（应用可自行在 refresh 中实现）
- 不实现 token 刷新（平台使用 cookie session，无需前端管理）
- 不修改 server 端行为
- 不为 mutation hooks（useCreate/useUpdate/useDelete）添加 error 状态——它们直接返回 Promise，调用方自行 catch

## Decisions

### D1: LocalAppError 继承 Error 并携带 status

`request()` 在非 2xx 时抛出 `new LocalAppError(message, status)` 而非 `new Error(message)`。应用通过 `error.status === 401` 区分认证失败。

选择此方案而非返回 `{ data, error }` tuple 的原因：hooks 内部用 try/catch 处理更自然，mutation hooks 的调用方也可以 `try { await create(...) } catch (e) { if (e instanceof LocalAppError && e.status === 401) ... }`。

### D2: query hooks 用 try/catch 包裹，暴露 error state

每个 query hook 的 useEffect 内部：
```
try {
  const result = await client.method();
  setData(result);
} catch (e) {
  setError(e instanceof LocalAppError ? e : new LocalAppError(String(e), 0));
} finally {
  setLoading(false);
}
```

返回类型新增 `error: LocalAppError | null`。初始值为 `null`，失败后为错误对象，成功后重置为 `null`。

### D3: redirectToLogin 操作 window.parent

```typescript
export function redirectToLogin(): void {
  const target = window.parent !== window ? window.parent : window;
  target.location.href = `/login?redirect=${encodeURIComponent(window.location.href)}`;
}
```

选择 `window.parent` 而非 `window` 的原因：登录页由平台 shell 提供（`/login` 路由在 serve.ts 中），iframe 内部跳转只会替换 iframe 内容。通过 `allow-same-origin` sandbox 属性，iframe 可以访问 `window.parent.location`。

redirect 参数让登录成功后自动回到当前页面。平台登录页已有此逻辑（`location.href = params.get('redirect') || '/'`）。

### D4: CLAUDE.md 补充 error 和 auth 指南

在现有 SDK 参考之后新增两个章节：
- "错误处理" — 展示如何使用 error 字段和 LocalAppError
- "登录引导" — 展示如何用 redirectToLogin 引导用户登录

使用完整的代码示例，让 AI 助手可以直接复制给用户。

## Risks / Trade-offs

- [window.parent 跨域风险] → 平台 iframe 使用 `allow-same-origin`，应用与平台同域，不存在跨域问题。若未来支持第三方域名部署，需改为 `postMessage` 方案。
- [error 状态不自动重置] → 每次 re-render 重新 fetch 时 error 被重置为 null，这是 React hooks 的自然行为。但如果应用在 error 后不触发 re-render，error 会一直保留。这是合理的——应用应在错误 UI 中提供重试按钮调用 `refresh()`。
- [向后兼容] → 新增 `error` 字段不影响现有解构 `{ rows, loading }`，无破坏性变更。

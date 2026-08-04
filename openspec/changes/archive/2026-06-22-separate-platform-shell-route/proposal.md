## Why

当前 PlatformShell 的生产模板使用 `packages/web/app/serve/[userId]/[name]` 导出，但 `/serve/{user}/{app}` 在服务端已经是裸应用资源路径。这个命名重叠导致平台开发时对 shell 与裸资源的职责判断混乱，并让 Next dev 的 `/serve` rewrite 抢占 shell 页面，访问 `localhost:3001/serve/...` 会进入重定向循环。

需要将平台生产 shell 模板路径从 `/serve` 语义中拆出，使“正式应用入口”“裸应用资源”“应用开发者 DevShell”“平台开发者 shell 预览”四个概念有清晰边界。

## What Changes

- 将 `packages/web` 中用于渲染 `PlatformShell` 的静态导出模板从 `/serve/[userId]/[name]` 迁移到独立路径，例如 `/platform-shell/[userId]/[name]`。
- 更新 server 正式入口 `/:userId/:name` 的 shell 模板读取逻辑，改为读取新的 `web/out/platform-shell/placeholder/placeholder.html`，不再依赖 `web/out/serve/...`。
- 保留 server 裸应用资源路径 `/serve/:userId/:name/*` 的职责：只服务上传应用的 `index.html`、assets、SPA fallback 和应用 API，不渲染平台 nav-shell。
- 调整 `packages/web` 开发态代理，避免 Next dev 的 `/serve/:path*` rewrite 与 shell 路由或 server 裸资源路径互相抢占。
- 为平台开发者提供可热更新的 shell 预览路径，例如 `localhost:3001/platform-shell/{userId}/{name}`，该路径渲染 PlatformShell，并通过内部代理读取 server 的裸应用资源。
- 明确不修改 `init-repo/runtime/dev-shell.tsx` 的语义：应用开发者的 DevShell 仍只存在于 `localapp dev` / Vite dev 模式，不进入生产构建和生产路由。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- `platform-shell`: PlatformShell 的静态导出模板 SHALL 使用独立于 `/serve` 裸资源路径的模板路由，并支持平台开发者在 Next dev 中热更新预览。
- `page-serving`: `/:userId/:name` SHALL 继续作为正式带 nav-shell 的应用入口；`/serve/:userId/:name/*` SHALL 保持裸应用资源服务，不承担 shell 渲染职责。
- `web-app`: Next.js 开发代理 SHALL 避免劫持 PlatformShell 模板路由，并提供不会与 `/serve` 语义冲突的内部裸资源代理路径。

## Impact

- `packages/web/app/serve/[userId]/[name]/...`：迁移到新的 PlatformShell 模板路由目录。
- `packages/web/next.config.ts`：调整 dev rewrites，移除或替换 `/serve/:path*` 代理。
- `packages/web/components/shell/platform-shell.tsx`：区分生产环境和 Next dev 预览环境中的裸应用资源 base URL。
- `packages/server/src/routes/serve.ts`：更新 shell 模板读取路径和 RSC 参数替换逻辑，保持 `/serve` 裸资源路由不变。
- 测试：补充 server 路由测试、web 构建输出测试和浏览器验证，覆盖 `3000/:user/:app`、`3000/serve/:user/:app/`、`3001/platform-shell/:user/:app` 的职责分离。

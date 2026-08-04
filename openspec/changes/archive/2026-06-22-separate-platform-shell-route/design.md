## Context

当前系统存在三套容易被混淆的外壳/资源机制：

```
生产正式入口     3000/:userId/:name        -> 平台 PlatformShell + native app
裸应用资源       3000/serve/:userId/:name   -> 上传应用 index.html/assets/API
应用开发 DevShell localapp dev / Vite       -> init-repo runtime 注入，仅开发态
```

问题出在 `packages/web` 的 PlatformShell 静态模板也放在 `/serve/[userId]/[name]` 路由下。生产 server 读取 `web/out/serve/placeholder/placeholder.html` 作为 shell 模板，但 server 自身的 `/serve/:userId/:name/*` 又代表裸应用资源。与此同时，`packages/web/next.config.ts` 在开发态将 `/serve/:path*` rewrite 到 `localhost:3000/serve/:path*`，导致 Next dev 的 shell 页面被代理抢占，甚至出现尾斜杠 301/308 重定向循环。

这不是应用开发者 DevShell 的问题。`init-repo/runtime/dev-shell.tsx` 仍应只属于 `localapp dev` 本地应用开发体验，不应被提升为生产机制。

## Goals / Non-Goals

**Goals:**

- 让 PlatformShell 的静态导出模板使用独立路径，不再占用 `/serve` 语义。
- 保持 `/:userId/:name` 是正式带 nav-shell 的生产应用入口。
- 保持 `/serve/:userId/:name/*` 是裸应用资源和应用 API 入口。
- 提供平台开发者可热更新预览 PlatformShell 的 Next dev 路径。
- 移除 Next dev 中导致 `/serve` 路径重定向循环的 rewrite 冲突。
- 保持应用开发者 DevShell 的生产隔离，不把 dev-only UI、事件或 API 带入生产路径。

**Non-Goals:**

- 不重构 PlatformShell 的导航栏、AI、Issue、收藏或通知业务功能。
- 不改变上传产物的目录结构和 `/serve` 裸资源访问契约。
- 不修改 `init-repo/runtime/dev-shell.tsx` 的能力、布局或注入方式。
- 不要求 `pnpm dev` 自动让 `3000/:userId/:name` 具备热更新；这可作为后续增强。

## Decisions

### 决策 1：将 PlatformShell 模板路由迁移到 `/platform-shell/[userId]/[name]`

`packages/web/app/serve/[userId]/[name]` SHALL 迁移为 `packages/web/app/platform-shell/[userId]/[name]`。该路由仍渲染 `PlatformShell`，并继续通过 `generateStaticParams()` 生成 placeholder 静态导出。

选择 `/platform-shell` 的原因是它直接表达“平台外壳模板”，不会被理解为上传应用资源路径，也不会和 server 的 `/serve` 资源路由冲突。

替代方案是保留 `/serve` 并调整 rewrites。该方案只能修掉当前循环，不能消除语义冲突，因此不采用。

### 决策 2：server 正式入口读取新的 shell 模板路径

`packages/server/src/routes/serve.ts` 中 `/:userId/:name` 路由 SHALL 改为读取：

```text
web/out/platform-shell/placeholder/placeholder.html
```

同时 RSC payload 参数替换 SHALL 从 `["platform-shell","placeholder","placeholder"]` 替换为实际 `userId/name`。`injectNativeShellMetadata()` 继续负责注入 native app resource base，保持生产应用资源仍从 `/serve/{userId}/{name}/` 加载。

### 决策 3：Next dev 使用内部裸资源代理路径

`packages/web/next.config.ts` SHALL 不再将 `/serve/:path*` 代理到 server。PlatformShell 在 Next dev 中加载裸应用资源时 SHALL 使用内部路径，例如：

```text
/_localapp/raw/:userId/:name/:path*
```

该路径由 Next rewrite 到：

```text
http://localhost:3000/serve/:userId/:name/:path*
```

生产环境仍使用 `/serve/:userId/:name/`。PlatformShell 可通过运行环境或当前 origin/port 判断 resource base；实现细节应集中在一个 helper 中，避免组件内部散落条件分支。

替代方案是让 PlatformShell dev 直接请求 `http://localhost:3000/serve/...`。该方案会遇到跨 origin cookie、CSP、相对资源和环境差异问题，因此优先使用同 origin 内部代理。

### 决策 4：应用开发 DevShell 不参与本变更

`init-repo` 的 DevShell 是应用开发者在 `localapp dev` 中看到的外壳投影。它与 `packages/web` 的生产 PlatformShell 模板不是同一个机制。本变更 SHALL 不修改 DevShell 注入、不新增 dev-only 生产路由，也不把 `DEV` 按钮、`/api/dev/*` 或 dev event 带入 `packages/web` 生产构建。

### 决策 5：验证入口按职责拆分

验收时 SHALL 分别验证：

```
3000/:userId/:name/             -> 生产 PlatformShell，带 nav-shell
3000/serve/:userId/:name/       -> 裸应用 index.html，无 nav-shell
3001/platform-shell/:userId/:name -> Next dev PlatformShell，可热更新 shell
```

其中 `3001/platform-shell/...` 是平台开发者调试 shell 的入口，不是最终用户生产入口，也不是应用开发者 DevShell。

## Risks / Trade-offs

- [Risk] Next 静态导出的 RSC payload 替换字符串随 Next 版本变化。
  Mitigation: 测试覆盖构建后的 `platform-shell/placeholder/placeholder.html`，并验证 `3000/:user/:app` 注入后的真实响应包含正确参数和 resource base。

- [Risk] 内部代理路径遗漏某些裸资源请求形式，导致 dev shell 能打开但资源加载失败。
  Mitigation: 覆盖 index.html、CSS、JS asset 和 SPA fallback 的 dev 代理测试。

- [Risk] 迁移目录后旧的 `/serve/placeholder/placeholder.html` 残留让问题被掩盖。
  Mitigation: 构建测试断言 shell 模板存在于 `platform-shell`，并断言不再依赖 `web/out/serve/placeholder/placeholder.html`。

- [Risk] `3000/:user/:app` 仍需 build 才能看到 shell 修改。
  Mitigation: 本变更提供 `3001/platform-shell/:user/:app` 作为热更新预览入口；是否进一步让 server dev 代理正式入口到 Next dev 留作后续增强。

## Migration Plan

1. 增加 RED 测试，锁定 `/serve` 裸资源与 PlatformShell 模板路径分离。
2. 迁移 Next PlatformShell 路由目录，更新 server 模板读取和参数替换逻辑。
3. 调整 Next dev rewrites 和 PlatformShell resource base helper。
4. 运行 web build、server 路由测试和浏览器验证。
5. 如发现问题，回滚到旧路由目录和旧模板读取路径；此变更不迁移数据，不影响已上传应用文件。

## Open Questions

- 是否要在后续变更中让 `3000/:userId/:name` 在开发模式下直接代理到 `3001/platform-shell/:userId/:name`，从而让正式入口也具备热更新？
- `platform-shell` 路由是否需要隐藏为 `/_platform-shell` 以减少被用户误访问的概率？当前默认选择可读性更高的公开模板路径。

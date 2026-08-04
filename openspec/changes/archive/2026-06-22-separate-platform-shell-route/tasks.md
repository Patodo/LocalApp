## 1. RED：锁定路由职责和当前缺陷

- [x] 1.1 增加 web 构建输出测试：期望 PlatformShell 模板输出到 `web/out/platform-shell/placeholder/placeholder.html`，且不再依赖 `web/out/serve/placeholder/placeholder.html`
- [x] 1.2 增加 server 路由测试：`GET /{userId}/{name}/` 返回带 native shell 标识的 PlatformShell HTML
- [x] 1.3 增加 server 路由测试：`GET /serve/{userId}/{name}/` 返回裸应用 `index.html`，且不包含 native shell 标识
- [x] 1.4 增加 Next dev rewrite 静态测试：development rewrites 不再包含 `source: "/serve/:path*"`，并包含内部裸资源代理路径
- [x] 1.5 增加 PlatformShell resource base 测试：生产入口使用 `/serve/{userId}/{name}/`，Next dev 预览使用内部代理路径
- [x] 1.6 运行相关测试，确认新增 RED 测试在现状下失败
- [x] 1.7 提交 RED 阶段测试，commit message 使用 `test(platform-shell): 锁定外壳路由职责`

## 2. GREEN：迁移 PlatformShell 模板路由

- [x] 2.1 将 `packages/web/app/serve/[userId]/[name]` 迁移到 `packages/web/app/platform-shell/[userId]/[name]`
- [x] 2.2 保持 `ServeClient`/页面组件语义，必要时重命名为 `PlatformShellClient` 以反映模板职责
- [x] 2.3 更新 `generateStaticParams()`，确保仍生成 `placeholder/placeholder` 静态模板
- [x] 2.4 更新 `packages/server/src/routes/serve.ts`，正式入口改读 `web/out/platform-shell/placeholder/placeholder.html`
- [x] 2.5 更新 server 中 RSC payload 参数替换规则，将 `platform-shell/placeholder/placeholder` 替换为实际 `userId/name`
- [x] 2.6 保持 `injectNativeShellMetadata()` 注入的 resource base 为 `/serve/{userId}/{name}/`
- [x] 2.7 运行 web build 和 server 路由测试，确认正式入口和裸资源入口职责分离
- [x] 2.8 提交 GREEN 阶段实现，commit message 使用 `fix(platform-shell): 拆分外壳模板路由`

## 3. GREEN：修复 Next dev shell 预览

- [x] 3.1 修改 `packages/web/next.config.ts`，移除 development 中的 `/serve/:path*` rewrite
- [x] 3.2 增加内部裸资源代理 rewrite，例如 `/_localapp/raw/:path* -> http://localhost:3000/serve/:path*`
- [x] 3.3 在 PlatformShell 中抽取 resource base 解析 helper，集中区分生产正式入口和 Next dev 预览入口
- [x] 3.4 更新 PlatformShell 加载裸应用 `index.html`、CSS 和 JS 的 URL 解析，确保 dev 预览走内部代理路径
- [x] 3.5 确认 `3001/platform-shell/{userId}/{name}` 不再进入 `/serve` 尾斜杠重定向循环
- [x] 3.6 运行相关测试，确认 RED 阶段的 dev rewrite 和 resource base 测试通过
- [x] 3.7 提交 GREEN 阶段实现，commit message 使用 `fix(web): 修复外壳开发预览代理`

## 4. REFACTOR：命名和边界收敛

- [x] 4.1 清理 `serve` 命名残留，确保 shell 模板组件、变量和测试描述使用 `platform-shell` 语义
- [x] 4.2 检查 `packages/server/src/routes/serve.ts` 注释，明确 `/:userId/:name` 是正式入口，`/serve/:userId/:name/*` 是裸资源入口
- [x] 4.3 检查 `packages/web` 中的 route、helper 和测试，避免把应用开发 DevShell 与 PlatformShell 预览混用
- [x] 4.4 确认 `init-repo/runtime/dev-shell.tsx` 未被修改，生产构建不包含 DevShell 标识
- [x] 4.5 运行格式化或相关 lint/typecheck，确认重命名没有遗留导入问题
- [x] 4.6 提交 REFACTOR 阶段整理，commit message 使用 `refactor(platform-shell): 收敛外壳命名边界`

## 5. 验证：构建、浏览器和 OpenSpec

- [x] 5.1 运行 `pnpm -C packages/web build`，确认导出 `platform-shell/placeholder/placeholder.html`
- [x] 5.2 运行 server/web 相关测试，覆盖正式入口、裸资源入口和 dev rewrite
- [x] 5.3 启动 `pnpm dev`，使用浏览器验证 `http://localhost:3000/{userId}/{name}/` 返回带 nav-shell 的正式应用
- [x] 5.4 使用浏览器验证 `http://localhost:3000/serve/{userId}/{name}/` 返回裸应用且无 nav-shell
- [x] 5.5 使用浏览器验证 `http://localhost:3001/platform-shell/{userId}/{name}` 可渲染 shell，不出现 `ERR_TOO_MANY_REDIRECTS`
- [x] 5.6 运行 `openspec validate separate-platform-shell-route --strict`
- [x] 5.7 检查 `git diff`，确认没有混入 CLI 编译产物、用户环境文件或无关 `.claude/settings.json` 变更
- [x] 5.8 提交最终验收，commit message 使用 `chore(platform-shell): 完成外壳路由拆分方案`

## 1. DevShell 视觉锚点彩条（启动阶段）

- [x] 1.1 RED：在 init-repo 测试套件中添加测试，断言 `runtime/dev-shell.tsx` 的 nav 标签内包含 `<div className="h-[3px] bg-gradient-to-r from-indigo-500 via-fuchsia-500 to-orange-400" />`
- [x] 1.2 GREEN：修改 `init-repo/runtime/dev-shell.tsx`，在 nav 的关闭标签前添加彩条 div
- [x] 1.3 验证：运行 init-repo 测试套件，新测试通过且现有测试不回归
- [x] 1.4 提交：`feat(init-template): dev-shell 增加 nav 底部彩条对齐 nav-shell 视觉锚点`

## 2. vite-plugin 虚拟模块注入（核心架构）

- [x] 2.1 RED：编写测试 `init-repo/tests/vite-plugin.test.mjs`，断言 localapp plugin 对象在 `command: 'serve'` 时返回 transformIndexHtml 钩子，且该钩子能把 `<script type="module" crossorigin src="/src/main.tsx"></script>` 替换为 `<script type="module" src="/virtual:localapp-dev"></script>`
- [x] 2.2 GREEN：修改 `init-repo/runtime/vite-plugin.mjs`，添加 `transformIndexHtml` 钩子（仅在 dev 模式激活，正则替换 main.tsx 引用）
- [x] 2.3 验证：测试通过
- [x] 2.4 RED：扩展测试，断言 localapp plugin 包含 `resolveId` 钩子，能识别 `/virtual:localapp-dev` 和 `\0virtual:localapp-dev` ID
- [x] 2.5 GREEN：在 vite-plugin.mjs 添加 `resolveId` 钩子返回虚拟 ID
- [x] 2.6 验证：测试通过
- [x] 2.7 RED：扩展测试，断言 localapp plugin 包含 `load` 钩子，对 `\0virtual:localapp-dev` 返回的字符串包含 `import { DevShell } from "@localapp/app-kit/dev-shell"`、`import App from "/src/App.tsx"`、`createRoot`、`<DevShell><App /></DevShell>` 四个关键片段
- [x] 2.8 GREEN：在 vite-plugin.mjs 添加 `load` 钩子返回虚拟模块代码字符串
- [x] 2.9 验证：测试通过
- [x] 2.10 RED：编写测试断言 `command: 'build'` 时 transformIndexHtml 返回 null 或 undefined（不修改 html）
- [x] 2.11 GREEN：在 transformIndexHtml 内部检查 command，非 serve 时直接返回
- [x] 2.12 验证：所有 vite-plugin 测试通过
- [x] 2.13 提交：`feat(init-template): vite-plugin 实现虚拟模块注入 DevShell 机制`

## 3. main.tsx 模板简化

- [x] 3.1 RED：编写测试断言 `init-repo/src/main.tsx` 不包含 `DevShell` 字符串
- [x] 3.2 GREEN：修改 `init-repo/src/main.tsx` 为只 render App 的极简版本（约 4-5 行）
- [x] 3.3 验证：测试通过；手动运行 `npm run build` 检查 dist 不含 DevShell（grep `"DevShell"`, `"localapp-dev"`）
- [x] 3.4 提交：`refactor(init-template): main.tsx 简化为只 render App,DevShell 由 vite-plugin 注入`

## 4. dev 鉴权注入

- [x] 4.1 RED：扩展 vite-plugin 测试，断言当 dev-config.json 包含 `apiKey: "key_xxx"` 时，buildProxy 返回的 proxy 配置中 `/api`、`/api/me`、`/api/users` 等所有端点的 configure 钩子在 proxyReq 上设置 `X-API-Key: key_xxx` header
- [x] 4.2 GREEN：修改 `init-repo/runtime/vite-plugin.mjs` 的 buildProxy 函数，当 devConfig.apiKey 非空时给所有 proxy 配置添加 `configure` 钩子注入 X-API-Key header
- [x] 4.3 验证：测试通过
- [x] 4.4 RED：扩展测试，断言当 devConfig.apiKey 为空字符串或不存在时，buildProxy 不添加 configure 钩子（或添加但不设置 header）
- [x] 4.5 GREEN：调整 buildProxy 的条件判断，确保空 apiKey 不注入
- [x] 4.6 验证：测试通过
- [x] 4.7 修改 `packages/cli/src/commands/dev.rs` 的 `write_dev_config` 函数，在 config_json 中新增 `apiKey` 字段，值从 `Config::load()` 的 api_key 读取
- [x] 4.8 RED：扩展或新增 CLI 测试，断言 `localapp dev` 写入的 dev-config.json 包含 apiKey 字段（已登录时为实际 key，未登录时为空字符串）
- [x] 4.9 GREEN：调整 dev.rs 让测试通过
- [x] 4.10 验证：测试通过；手动运行 `cargo build` 编译 CLI，执行 `localapp dev` 验证 dev-config.json 内容
- [x] 4.11 提交：`feat(cli,init-template): dev-config 增加 apiKey 字段,vite-proxy 注入 X-API-Key`

## 5. sync 自动 patch main.tsx

- [x] 5.1 RED：在 `packages/cli/tests/` 添加测试，构造一个内容等于旧模板的 main.tsx（commit `a0f72c3` 版本），调用 sync 的 main.tsx patch 函数，断言文件被改写为新版（只 render App，无 DevShell 引用）
- [x] 5.2 GREEN：在 `packages/cli/src/template.rs`（或 sync.rs）添加 `patch_legacy_main_tsx` 函数，严格匹配旧模板字面量时改写为新版
- [x] 5.3 验证：测试通过
- [x] 5.4 RED：扩展测试，构造一个含 DevShell 引用但与旧模板不完全相同的 main.tsx（模拟用户自定义），断言文件不被改写、返回值/输出包含警告信息
- [x] 5.5 GREEN：调整 patch 逻辑，仅在严格匹配时改写，否则打印警告但不报错
- [x] 5.6 验证：测试通过
- [x] 5.7 RED：扩展测试，构造一个不含 DevShell 引用的 main.tsx（新版），断言 patch 函数不做任何修改、不打印警告
- [x] 5.8 GREEN：调整 patch 逻辑，跳过无 DevShell 引用的文件
- [x] 5.9 验证：测试通过
- [x] 5.10 RED：扩展测试，构造 main.tsx 不存在的场景，断言 patch 函数不报错（graceful skip）
- [x] 5.11 GREEN：在 patch 函数入口检查文件存在性，不存在时直接返回 Ok
- [x] 5.12 验证：所有 patch 测试通过
- [x] 5.13 在 `packages/cli/src/commands/sync.rs` 的 sync 流程中调用 `patch_legacy_main_tsx`（在 runtime/skills 覆盖之后、提示用户之前）
- [x] 5.14 验证：手动执行 sync 命令，在 sample-app 项目（或测试项目）上验证 main.tsx 自动迁移行为
- [x] 5.15 提交：`feat(cli): sync 自动 patch 旧版 main.tsx,移除 DevShell 引用`

## 6. 文档与 CLAUDE.md 更新

- [x] 6.1 修改 `init-repo/CLAUDE.md`，在「核心规则」章节新增条目说明 main.tsx 现在纯净、DevShell 由 vite-plugin 自动注入、用户不应手动引用 DevShell
- [x] 6.2 修改 `init-repo/CLAUDE.md`，更新「开发工作流」章节说明 dev 模式的鉴权机制（依赖 dev-config.json 的 apiKey，由 localapp dev 命令写入）
- [x] 6.3 验证：阅读 CLAUDE.md 确认文档清晰准确
- [x] 6.4 提交：`docs(init-template): CLAUDE.md 说明 DevShell 注入机制和 dev 鉴权`

## 7. 端到端验证

- [ ] 7.1 e2e：使用新版 CLI 在临时目录 `localapp init` 创建测试项目，运行 `npm run dev`，浏览器访问验证 DevShell 工具栏出现且 App 正常加载
- [ ] 7.2 e2e：在上一步的 dev 模式下，验证 `/api/me` 请求带上 X-API-Key header（用浏览器 devtools Network 面板检查），返回当前登录用户信息（非 null）
- [x] 7.3 e2e：在测试项目运行 `npm run build`，对 `dist/` 目录执行 `grep -r "DevShell\|localapp-dev\|@localapp/app-kit/dev-shell" dist/`，断言结果为空
- [ ] 7.4 e2e：执行 `localapp upload` 上传到 server，浏览器访问 `http://localhost:3000/<user>/<page>`，验证只出现 nav-shell 单壳（无 DEV 徽章、无 DevShell 工具栏）
- [x] 7.5 e2e：构造一个旧版 main.tsx（含 DevShell 引用）的项目，运行 `localapp sync`，验证 main.tsx 自动迁移为新版（只 render App）
- [x] 7.6 e2e：构造一个自定义 main.tsx（含 DevShell 引用但与旧模板不同）的项目，运行 `localapp sync`，验证文件未被改写、终端打印警告
- [x] 7.7 提交：`test(e2e): 验证 DevShell 隔离、dev 鉴权、sync 自动迁移的端到端行为`

## 8. 完成检查

- [x] 8.1 运行 init-repo 的全部测试套件，所有测试通过
- [x] 8.2 运行 packages/cli 的全部测试套件，所有测试通过
- [x] 8.3 运行 server 的相关 e2e 测试，无回归
- [ ] 8.4 手动验证 dev/build/upload 全链路：dev 模式有 DevShell、生产构建无 DevShell、上线后单壳
- [ ] 8.5 提交剩余变更（如有）

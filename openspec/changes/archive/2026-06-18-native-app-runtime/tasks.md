## 1. RED: native 生产壳测试

- [x] 1.1 增加 server/web 集成测试：访问生产应用入口时页面包含平台 shell 和 native app mount，且不包含应用 iframe
- [x] 1.2 增加资源加载测试：上传 Vite dist 后，生产 shell 能定位并加载最新版本 JS/CSS 资源
- [x] 1.3 增加 page-serving 回归测试：静态资源、SPA fallback、缺失带扩展名资源 404 在 native 模式下保持正确
- [x] 1.4 增加 shell.navbar=false 旧行为移除测试：生产入口不再重定向到无壳 iframe 页面

## 2. GREEN: native shell 生产实现

- [x] 2.1 改造生产 `PlatformShell`：移除 iframe，提供 app mount container、平台 nav、AI、Issue、用户入口和确认弹窗
- [x] 2.2 实现生产应用资源解析：从 currentVersion 的 `index.html` 提取 Vite module script 和 stylesheet 并注入 native shell
- [x] 2.3 调整 `/serve/{userId}/{name}` 静态资源服务：保留 assets 服务和 Named SQL API，避免与 native shell 入口冲突
- [x] 2.4 更新 CSP 和资源路径策略，确保 native app 资源可加载且不引入 iframe sandbox 依赖
- [x] 2.5 跑生产相关测试并提交：`test: native production shell`

## 3. RED: SDK native platform host 测试

- [x] 3.1 增加 SDK 测试：`platform-runtime` 在同页 native host 下发起标准平台能力请求并收到响应
- [x] 3.2 增加 SDK 测试：`platform.confirm` 不调用 `window.confirm`
- [x] 3.3 增加工具注册测试：`useRegisterTools` 在 native 模式下注册到同页 shell registry，而非依赖 iframe parent

## 4. GREEN: SDK 平台能力运行时

- [x] 4.1 实现 SDK native host adapter，保留统一 `platform` API
- [x] 4.2 实现同页工具 registry 和平台 AI 调用工具的执行链路
- [x] 4.3 更新 postmessage 类型和兼容测试，明确 postMessage 不再是默认生产路径
- [x] 4.4 跑 `packages/sdk-agent` 测试和类型检查并提交：`test: native platform runtime`

## 5. RED: dev-shell 对齐生产 nav-shell

- [x] 5.1 增加 init-repo 模板测试：DevShell 顶栏必须派生生产 nav-shell，唯一额外入口为最左侧 `DEV`
- [x] 5.2 增加 dev platform host 测试：dev 中 `confirm/download/copyText/ai/openRoute/getCurrentUser/getServerTime` 通过同页 host 响应
- [x] 5.3 增加 dist 隔离测试：生产构建不包含 DEV 工具、`/api/dev/*`、iframe/sandbox dev 代码

## 6. GREEN: dev runtime 与 mini-server

- [x] 6.1 改造 `init-repo/runtime/dev-shell.tsx`：复用生产 nav-shell 模型并注入 `DEV` 下拉
- [x] 6.2 改造 `init-repo/runtime/vite-plugin.mjs`：确保 dev 注入 native DevShell + App 且 build no-op
- [x] 6.3 确认 mini-server 继续提供 `/api/dev/*`、Named SQL、平台辅助 API 和 API 分流
- [x] 6.4 跑 `init-repo` 测试和构建并提交：`test: native dev shell`

## 7. RED: CLI sync/init/dev 测试

- [x] 7.1 增加 CLI staging 测试：debug/release 构建产物包含 native runtime 文件和 version.json
- [x] 7.2 增加 sync 测试：`localapp sync` 会覆盖旧 iframe runtime 并写入 native runtime
- [x] 7.3 增加 init 测试：`localapp init` 生成 native 兼容模板、backend contract 示例和平台能力文档
- [x] 7.4 增加 dev 测试：`localapp dev` 写入 miniServerPort 并启动 native dev shell

## 8. GREEN: CLI 与 init-repo 交付

- [x] 8.1 更新 CLI build staging：把 native runtime、vite plugin、styles、SDK 和 mini-server 打包进 debug/release 二进制
- [x] 8.2 更新 `localapp sync` 逻辑：移除旧 iframe runtime 假设并保留用户代码
- [x] 8.3 更新 `localapp init` 内置模板、skills、docs 和示例代码，删除 iframe/sandbox 指南
- [x] 8.4 跑 CLI Rust 测试、构建 debug CLI 并提交：`test: native cli runtime`

## 9. REFACTOR: 清理旧 iframe 路径

- [x] 9.1 删除或改写生产 iframe wrapper、`sandbox`、`window.parent` 默认路径和相关文档
- [x] 9.2 清理 web/server/init-repo 中失效的 iframe e2e 断言
- [x] 9.3 更新 OpenSpec 主规格相关描述中的 iframe 表述，准备后续归档
- [x] 9.4 跑全量相关测试并提交：`refactor: remove iframe runtime path`

## 10. 最终验证与收尾

- [x] 10.1 启动平台 server，上传或访问测试应用，确认生产页面无 iframe 且应用可交互
- [x] 10.2 在 `sample-app` 执行 `localapp sync`、`npm install`、`localapp dev`，确认 dev shell 与生产 nav-shell 对齐
- [x] 10.3 验证平台能力：confirm、download、copyText、getCurrentUser、getServerTime、AI toggle 在 dev 和生产均可用
- [x] 10.4 验证 Named SQL 和上传迁移链路不回归
- [x] 10.5 构建最新 debug CLI，确认 `C:\bin\localapp.exe --version` 指向新版本
- [x] 10.6 完成最终提交：`feat: switch apps to native runtime`

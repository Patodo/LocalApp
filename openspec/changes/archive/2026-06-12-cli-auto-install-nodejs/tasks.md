## 1. Server 端：新增 Node.js 分发路由

- [x] 1.1 RED：确认 `GET /api/deps/node` 返回 404（路由不存在）
- [x] 1.2 GREEN：在 `packages/server/src/routes/` 新增 `deps.ts`，实现 `GET /api/deps/node`（读取 `static/deps/node.json`）和 `GET /api/deps/node/download`（流式返回 .msi，带 Content-Disposition）
- [x] 1.3 GREEN：在 `packages/server/src/index.ts` 注册 deps 路由为公开路由
- [x] 1.4 验证：启动 server，curl 确认 404（无 node.json 时）和正确路由注册

## 2. CLI 端：自动安装 Node.js

- [x] 2.1 RED：确认 `pm::check_available()` 在无 Node.js 时直接报错退出
- [x] 2.2 GREEN：在 `packages/cli/src/pm.rs` 中实现 `try_install_nodejs()`，从 server 获取 node.json、下载 .msi 到临时目录、用 `opener` 或 `std::process::Command` 启动安装向导
- [x] 2.3 GREEN：修改 `check_available()` 在检测失败时调用 `try_install_nodejs()`，并添加用户确认提示
- [x] 2.4 GREEN：server 返回 404 时降级打印 nodejs.org 链接
- [x] 2.5 验证：在无 Node.js 的环境中运行 CLI，确认自动安装流程和降级行为

## 3. 收尾

- [x] 3.1 运行 `cargo build` 确认 CLI 编译通过
- [x] 3.2 更新任务清单勾选已完成项

## 1. CLI dev 命令 — 写入 dev-config.json

- [x] 1.1 修改 `commands/dev.rs` — 从 manifest.json 读取 `name` 作为 `pageName`
- [x] 1.2 实现 userId 推断逻辑（已登录用户 > OS 用户名）
- [x] 1.3 在启动 npm run dev 前写入 `.localapp/dev-config.json`（含 serverUrl、userId、pageName）
- [x] 1.4 移除 `--proxy` 标志 — 代理模式由 dev-config.json 中的 serverUrl 控制，默认启用
- [x] 1.5 更新 `main.rs` 中 Dev 命令参数定义

## 2. Vite 模板 — 代理路径改写

- [x] 2.1 修改 `init-repo/vite.config.ts` — 读取 dev-config.json 中的 userId 和 pageName
- [x] 2.2 实现 `/api/*` 请求路径改写逻辑：`/api/bugs` → `/serve/{userId}/{pageName}/api/bugs`
- [x] 2.3 确保 `/serve/*` 路径直接转发（不改写）

## 3. CLI init 命令 — skip 标志拆分

- [x] 3.1 在 `commands/init.rs` 中添加 `--skip-install` 标志
- [x] 3.2 修改 `--skip-deploy` 逻辑 — 不再跳过 npm install
- [x] 3.3 更新 `main.rs` 中 Init 命令参数定义

## 4. 编译和安装

- [x] 4.1 编译 CLI Release 二进制
- [x] 4.2 安装到 `~/.local/bin/localapp`，验证 `localapp --help` 包含 dev/generate/whoami/logout

## 5. 端到端验证

- [x] 5.1 使用新 CLI 从零初始化测试应用
- [x] 5.2 `localapp dev` 启动后验证 dev-config.json 被写入
- [x] 5.3 验证浏览器端 API 请求能正确路由到服务端（不再 404）
- [x] 5.4 `localapp init --skip-deploy` 验证 npm install 被执行
- [x] 5.5 `localapp init --skip-install` 验证 npm install 被跳过
- [x] 5.6 回归验证 `localapp generate` / `whoami` / `logout` 命令可用

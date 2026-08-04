## 1. dev 命令

- [x] 1.1 创建 `commands/dev.rs` — 实现 `localapp dev` 命令
- [x] 1.2 实现 `manifest.json` 读取和验证
- [x] 1.3 实现 `npm run dev` 子进程启动和输出转发
- [x] 1.4 实现 API 代理（`--proxy` 标志）
- [x] 1.5 注册 dev 命令到 `main.rs` — **commit: "feat(cli): add `localapp dev` command with API proxy"**

## 2. generate 命令

- [x] 2.1 创建 `commands/generate.rs` — 实现子命令路由（schema/page/component）
- [x] 2.2 实现 `generate schema <name>` — 生成 schema JSON 模板
- [x] 2.3 实现 `generate page <name>` — 生成页面 .tsx 骨架
- [x] 2.4 实现 `generate component <name>` — 生成组件 .tsx 骨架
- [x] 2.5 注册 generate 命令 — **commit: "feat(cli): add `localapp generate` scaffolding commands"**

## 3. whoami / logout

- [x] 3.1 创建 `commands/whoami.rs` — `GET /api/me` 并格式化输出
- [x] 3.2 实现 `logout` — 清除 `config.json` 中的 `api_key`
- [x] 3.3 注册 whoami 和 logout 命令 — **commit: "feat(cli): add `whoami` and `logout` commands"**

## 4. init 和 upload 重构

- [x] 4.1 修改 `commands/init.rs` — 保留 `--builtin-repo` 备用
- [x] 4.2 修改 `commands/upload.rs` — 移除 SDK 源码复制逻辑（Phase 1 已完成）
- [x] 4.3 编译 Rust CLI，验证所有命令可用 — **commit: "refactor(cli): use npm template for init, remove SDK copy from upload"**

## 5. 端到端验证

- [x] 5.1 `localapp init --name test-app` → 验证模板正确创建
- [x] 5.2 `localapp dev` → 验证 dev server 启动
- [x] 5.3 `localapp dev --proxy` → 验证 API 代理
- [x] 5.4 `localapp generate schema todos` → 验证文件生成
- [x] 5.5 `localapp whoami` → 验证用户信息显示
- [x] 5.6 `localapp logout && localapp whoami` → 验证登出生效 — **commit: "test: verify new CLI commands end-to-end"**

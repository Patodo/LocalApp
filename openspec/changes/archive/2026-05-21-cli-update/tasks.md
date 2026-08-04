## 1. Shared 类型定义 (RED)

- [x] 1.1 在 `packages/shared/src/api.ts` 中新增 `CliVersionResponse`、`CliDownloadQuery` 类型

## 2. Server 更新接口 (RED → GREEN)

- [x] 2.1 创建 `static/cli/versions.json` 示例版本清单
- [x] 2.2 创建 `packages/server/src/routes/cli.ts`，实现 `GET /api/cli/version` 和 `GET /api/cli/download`
- [x] 2.3 编写 Server 更新接口的单元测试，验证版本查询和下载返回正确状态码和内容
- [x] 2.4 运行测试确认全部通过 (GREEN)

## 3. Server 版本校验 (RED → GREEN)

- [x] 3.1 修改 `packages/server/src/plugins/auth.ts`，新增版本校验 hook：检查 `X-CLI-Version` header，低于 `MIN_CLI_VERSION` 或无 header 返回 403
- [x] 3.2 编写版本校验的单元测试：覆盖版本满足/版本过低/无 header/未配置/update 端点绕过的场景
- [x] 3.3 运行测试确认全部通过 (GREEN)

## 4. Server 路由注册 (REFACTOR)

- [x] 4.1 修改 `index.ts`：注册 cli update 路由在独立 auth scope（跳过版本检查）；在业务 auth scope 中注册版本校验 hook
- [x] 4.2 手动启动 Server 验证 update 端点可达且不受版本检查拦截

## 5. Commit: Server 端完成

- [x] 5.1 `git add` 并提交 Server 侧所有变更，commit message: `feat(server): 添加 CLI 版本校验和更新下载接口`

## 6. CLI 版本 header (RED → GREEN)

- [x] 6.1 在 `packages/cli/src/client.rs` 中新增 `VERSION` 常量（`env!("CARGO_PKG_VERSION")`），所有 HTTP 方法添加 `.header("X-CLI-Version", VERSION)`
- [x] 6.2 `cargo check` 确认编译通过 (GREEN)

## 7. CLI update 命令 (RED → GREEN)

- [x] 7.1 创建 `packages/cli/src/commands/update.rs`：实现平台检测、版本查询、二进制下载、自替换（Windows rename 策略 / Unix 直接覆盖）、`.old` 文件清理
- [x] 7.2 在 `packages/cli/src/commands/mod.rs` 中声明 `pub mod update;`
- [x] 7.3 在 `packages/cli/src/main.rs` 中添加 `Update` 子命令到 `Commands` enum 和 `match` 分支
- [x] 7.4 `cargo check` 确认编译通过 (GREEN)

## 8. Commit: CLI 端完成

- [x] 8.1 `git add` 并提交 CLI 侧所有变更，commit message: `feat(cli): 添加 update 命令和 X-CLI-Version header`

## 9. 端到端验证

- [ ] 9.1 设置 `MIN_CLI_VERSION=0.2.0`，启动 Server，用旧版本 CLI 请求 pages 接口，确认返回 403
- [ ] 9.2 执行 `localapp update` 确认成功下载并替换二进制，新版本可正常请求
- [ ] 9.3 再次执行 `localapp update` 确认输出 "Already up to date"

> **手动验证步骤：**
> ```bash
> # 1. 启动 Server（设置 min 版本高于当前 CLI 版本）
> MIN_CLI_VERSION=0.2.0 pnpm --filter server dev
>
> # 2. 用当前 CLI (v0.1.0) 请求 business 端点
> cargo run -- pages list
> # 期望: 403 CLI version 0.1.0 is outdated...
>
> # 3. 执行 update
> cargo run -- update
> # 期望: 下载成功，输出 {"success": true, "version": "..."}
>
> # 4. 再次执行 update
> cargo run -- update
> # 期望: Already up to date
> ```

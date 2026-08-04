## 1. build.rs staging 目录排除 node_modules

- [x] 1.1 修改 `packages/cli/build.rs`：添加 `copy_dir_recursive` 函数和 staging 目录逻辑，排除 node_modules/dist/.next
- [x] 1.2 添加 `cargo:rerun-if-changed` 指令指向 init-repo 关键文件
- [x] 1.3 验证 `cargo build --release` 后二进制 < 30MB

## 2. Ad-hoc codesign 修复 exit 137

- [x] 2.1 在 `package.json` 的 `build:cli` 脚本中追加 `codesign -s -` 步骤
- [x] 2.2 验证 `codesign -v` 通过，复制到新路径后正常执行

## 3. sqlAccess 403 错误信息改进

- [x] 3.1 修改 `packages/server/src/routes/serve.ts` 的 sqlAccess 403 响应，包含 manifest.json 配置指引
- [x] 3.2 验证 app-db 测试全部通过

## 4. 文档补充

- [x] 4.1 在 `init-repo/CLAUDE.md` 添加部署注意事项（上传目录结构、sqlAccess 配置）
- [x] 4.2 验证 `localapp init --name test-app` 完整流程

## 5. 端到端验证

- [x] 5.1 使用新构建的 CLI 执行 init → build → upload 完整流程
- [x] 5.2 运行 `pnpm -C packages/server vitest run src/lib/__tests__/` 确认所有测试通过

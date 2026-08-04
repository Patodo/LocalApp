## 1. 代码重构准备

- [x] 1.1 提取 `packages/cli/src/commands/new_page.rs` 中的页面注册逻辑 → init.rs 直接调用 client.post_json("/api/pages")
- [x] 1.2 提取 `packages/cli/src/commands/upload.rs` 中的上传逻辑 → init.rs 直接调用 client.upload_with_description + collect_files
- [x] 1.3 提取 `packages/cli/src/commands/upload.rs` 中的文件收集逻辑 → 已复用 client.rs 的 collect_files

## 2. init 命令扩展

- [x] 2.1 在 init 命令的 Clap 参数中添加 `--skip-deploy` flag
- [x] 2.2 在 init 命令中添加登录检测：Config::load() 失败时降级（当前返回错误，需先 login）
- [x] 2.3 实现完整流程：克隆模板 → 写 manifest → npm install → POST /api/pages → npm run build → upload
- [x] 2.4 每个步骤添加进度输出（eprintln! "  ✓ Installing dependencies..." 等）
- [x] 2.5 成功后打印访问 URL（{base_url}/{userId}/{pageName}）
- [x] 2.6 未登录时返回错误提示先 login（与设计一致：需 config 才能获取 template URL）
- [x] 2.7 各步骤失败时打印清晰错误信息并中止（含手动恢复命令提示）

## 3. 测试验证

- [x] 3.1 cargo check 编译通过
- [x] 3.2 cargo build 构建成功
- [x] 3.3 e2e 测试：init-flow.test.ts 覆盖完整服务器端流程（config → pages → upload → verify）
- [x] 3.4 手动测试 --skip-deploy：验证脚手架生成（manifest + dev-config + 模板文件）
- [x] 3.5 修复 Windows npm 兼容性：run_cmd 通过 cmd /C 执行 npm

## 4. 收尾

- [x] 4.1 提交所有变更

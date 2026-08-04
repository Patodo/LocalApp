## 1. 迁移 SDK 测试到 init-repo

- [x] 1.1 将 `packages/client/src/__tests__/` 下的 4 个测试文件（client.test.ts、react.test.ts、mutations.test.ts、redirect.test.ts）复制到 `init-repo/src/lib/localapp/__tests__/`，修正导入路径（从相对路径 `./client` 等调整为适配新位置）
- [x] 1.2 在 `init-repo/` 目录执行 `npm test`，确认所有测试通过
- [x] 1.3 补充 init-repo 中缺失的测试覆盖（users、groups、groupMembers 等新增 API），确保测试覆盖与 init-repo 的 SDK 代码一致

## 2. 删除 packages/client 包

- [x] 2.1 确认 monorepo 内无其他包 import `@localapp/client`（grep `@localapp/client` 排除 packages/client 自身）
- [x] 2.2 从 `pnpm-workspace.yaml` 移除 `packages/client`
- [x] 2.3 从根 `package.json` 移除 `sync:sdk` 脚本
- [x] 2.4 删除 `packages/client/` 目录
- [x] 2.5 执行 `pnpm install` 确认 workspace 重新解析无报错

## 3. CLI upload 命令增加 SDK 刷新和构建

- [x] 3.1 在 `packages/cli/src/commands/upload.rs` 中新增 `refresh_sdk` 函数：使用 `include_dir!()` 提取内置模板的 `src/lib/localapp/` 目录，覆盖到用户项目的同名路径
- [x] 3.2 在 upload 命令流程中，SDK 刷新前检查用户项目是否存在 `src/lib/localapp/`，不存在则跳过（支持指定路径上传的兼容场景）
- [x] 3.3 新增 `run_build` 函数：在用户项目目录执行 `npm run build`，捕获输出，构建失败时返回错误
- [x] 3.4 修改 upload 主流程：无显式 path 参数时，执行 refresh_sdk → run_build → 从 manifest.json 的 distDir 收集文件 → 上传；有显式 path 时，保持原行为直接收集并上传
- [x] 3.5 编写单元测试验证 refresh_sdk 和 run_build 函数
- [x] 3.6 端到端验证：执行 `localapp upload`，确认 SDK 刷新 → 构建 → 上传完整流程正常

## 4. 更新 OpenSpec 规范

- [x] 4.1 更新 `openspec/specs/client-sdk/spec.md`，移除 `SDK 同步脚本` requirement，将 `SDK 包结构` requirement 中的源码位置改为 `init-repo/src/lib/localapp/`
- [x] 4.2 更新 `openspec/specs/init-template/spec.md`，移除 `SDK 源码预装` requirement 中对 `sync:sdk` 的引用
- [x] 4.3 更新 `openspec/specs/cli-tool/spec.md`，更新 `upload 命令` requirement 加入 SDK 刷新和构建步骤

## 5. 验证与提交

- [x] 5.1 在 init-repo 目录执行 `npm test`，确认所有 SDK 测试通过
- [x] 5.2 在 init-repo 目录执行 `npm run build`，确认模板构建正常
- [x] 5.3 提交所有变更，commit message 遵循 conventional commits 规范

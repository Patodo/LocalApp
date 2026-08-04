## Tasks

- [x] **Task 1: 重命名 tests/e2e/ 为 tests/integration/**
  将 `packages/server/tests/e2e` 重命名为 `packages/server/tests/integration`，更新 package.json 中 test script 路径，运行 `npx vitest run tests/integration/` 确认全部通过。

- [x] **Task 2: 在 e2e-ui helpers 中增加 runCli 辅助函数**
  添加 `runCli(args, options)` 函数：通过 `child_process.spawn` 执行 CLI 二进制，自动检测 `packages/cli/target/debug/localapp[.exe]` 路径，注入 `LOCALAPP_SERVER_URL` 和 `LOCALAPP_API_KEY` 环境变量。

- [x] **Task 3: 创建 CLI init → 页面访问 E2E 测试**
  新建 `packages/server/tests/e2e-ui/cli-init.test.ts`：启动 server → `runCli(["init", "--name", "test-app", "--builtin-repo"])` → Playwright 访问页面验证 200 和 HTML 内容。

- [x] **Task 4: 创建 CLI schemas → CRUD 验证 E2E 测试**
  新建 `packages/server/tests/e2e-ui/cli-crud.test.ts`：CLI init → `runCli(["schemas", "create", ...])` → Playwright `page.evaluate` CRUD 数据写入读取验证。

- [x] **Task 5: 创建 upload 更新 E2E 测试**
  新建 `packages/server/tests/e2e-ui/cli-upload.test.ts`：CLI init → 修改 dist 文件 → `runCli(["upload"])` → Playwright 访问验证页面内容已更新。

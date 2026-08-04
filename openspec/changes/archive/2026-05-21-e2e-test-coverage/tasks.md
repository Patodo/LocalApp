## 0. e2e 测试指导 Skill

- [x] 0.1 创建 `.claude/skills/e2e-test-guide/skill.md`，定义测试架构、Helper API（buildCli / createCliTestEnv / runCli / createTmpProjectDir）、编写模式（describe 结构、CLI 执行模式、page-serving 验证模式）、验收标准

## 1. 测试基础设施 (RED)

- [x] 1.1 创建 `packages/server/tests/e2e-cli/helpers.ts`：`buildCli()` 编译 CLI 二进制、`runCli(args, options)` 子进程执行器、`createTmpDir()` 临时目录管理、平台感知的二进制路径
- [x] 1.2 验证 helpers 编译通过，`runCli(["--version"])` 返回退出码 0

## 2. CLI new 命令 e2e (RED → GREEN → 验证)

- [x] 2.1 编写 e2e 测试：`localapp new` 成功创建 → 验证 stdout JSON 含 pageId、.localapp.json 已生成、退出码 0
- [x] 2.2 编写 e2e 测试：`localapp new` 未配置时失败 → 验证 stderr 含错误、退出码 1
- [x] 2.3 编写 e2e 测试：`localapp new` 目录已有 .localapp.json 时失败 → 验证 stderr 含 "Project already exists"、退出码 1
- [x] 2.4 运行测试确认通过，提交 commit

## 3. CLI upload 命令 e2e (RED → GREEN → 验证)

- [x] 3.1 编写 e2e 测试：`localapp upload ./dist` 成功上传含子目录的项目 → 验证 stdout JSON 含 version
- [x] 3.2 编写 e2e 测试：上传空目录 → 验证 stderr 含错误、退出码 1
- [x] 3.3 编写 e2e 测试：连续两次上传验证版本递增 → 第一次 version=1，第二次 version=2
- [x] 3.4 运行测试确认通过，提交 commit

## 4. page-serving 端到端 e2e (RED → GREEN → 验证)

- [x] 4.1 编写 e2e 测试：通过 CLI new + upload 后，`GET /{userId}/{pageId}` 返回 iframe HTML
- [x] 4.2 编写 e2e 测试：`GET /serve/{userId}/{pageId}` 返回 index.html（无尾部路径）
- [x] 4.3 编写 e2e 测试：`GET /serve/{userId}/{pageId}/` 返回 index.html（带尾部斜杠）
- [x] 4.4 编写 e2e 测试：上传含 `assets/style.css` 后，`GET /serve/.../assets/style.css` 返回正确 MIME
- [x] 4.5 编写 e2e 测试：`GET /serve/.../nonexistent.css` 返回 404
- [x] 4.6 编写 e2e 测试：SPA fallback — `GET /serve/.../about` 返回 index.html
- [x] 4.7 编写 e2e 测试：有扩展名的缺失文件不触发 fallback — `GET /serve/.../missing.js` 返回 404
- [x] 4.8 编写 e2e 测试：响应包含正确的 CSP 头
- [x] 4.9 运行测试确认通过，提交 commit

## 5. CLI pages 子命令 e2e (RED → GREEN → 验证)

- [x] 5.1 编写 e2e 测试：`localapp pages list` 输出页面列表
- [x] 5.2 编写 e2e 测试：`localapp pages info` 输出页面详情（从 .localapp.json 读取）
- [x] 5.3 编写 e2e 测试：`localapp pages delete <pageId>` 删除成功
- [x] 5.4 编写 e2e 测试：`localapp pages delete nonexistent` 失败
- [x] 5.5 运行测试确认通过，提交 commit

## 6. CLI schemas 子命令 e2e (RED → GREEN → 验证)

- [x] 6.1 编写 e2e 测试：`localapp schemas create todos --fields '...'` 成功
- [x] 6.2 编写 e2e 测试：`localapp schemas list` 输出 schema 列表
- [x] 6.3 编写 e2e 测试：`localapp schemas delete todos` 成功
- [x] 6.4 运行测试确认通过，提交 commit

## 7. 完整工作流 e2e (RED → GREEN → 验证)

- [x] 7.1 编写 e2e 测试：new → 创建测试文件 → upload → pages info → HTTP 访问验证完整流程
- [x] 7.2 运行所有 e2e-cli 测试确认全部通过
- [x] 7.3 运行全部测试（含原有 tests/e2e/）确认无回归，提交 commit

## 8. e2e Scenario 覆盖映射表

| Spec | Scenario | 测试文件 | Status |
|------|----------|----------|--------|
| e2e-cli-test-framework > CLI 二进制编译与定位 > 首次运行自动编译 | helpers.ts buildCli | tests/e2e-cli/helpers.ts | ✓ |
| e2e-cli-test-framework > CLI 二进制编译与定位 > 二进制已存在时跳过编译 | helpers.ts buildCli | tests/e2e-cli/helpers.ts | ✓ |
| e2e-cli-test-framework > 测试用 Server 启动 > Server 启动与配置 | helpers.ts createCliTestEnv | tests/e2e-cli/helpers.ts | ✓ |
| e2e-cli-test-framework > 测试用 Server 启动 > 测试套件结束后清理 | helpers.ts createCliTestEnv | tests/e2e-cli/helpers.ts | ✓ |
| e2e-cli-test-framework > CLI 子进程执行器 > 执行成功命令 | helpers.ts runCli | tests/e2e-cli/helpers.ts | ✓ |
| e2e-cli-test-framework > CLI 子进程执行器 > 执行失败命令 | helpers.ts runCli | tests/e2e-cli/helpers.ts | ✓ |
| e2e-cli-test-framework > CLI 子进程执行器 > 指定工作目录和环境变量 | helpers.ts runCli | tests/e2e-cli/helpers.ts | ✓ |
| e2e-cli-test-framework > 临时项目目录 > 创建临时项目目录 | helpers.ts createTmpDir | tests/e2e-cli/helpers.ts | ✓ |
| cli-tool > CLI new 命令 > 成功创建并生成 .localapp.json | new 命令 e2e | tests/e2e-cli/new-page.test.ts | ✓ |
| cli-tool > CLI new 命令 > 未配置时创建失败 | new 命令 e2e | tests/e2e-cli/new-page.test.ts | ✓ |
| cli-tool > CLI new 命令 > 目录已有项目时创建失败 | new 命令 e2e | tests/e2e-cli/new-page.test.ts | ✓ |
| file-upload > CLI upload 端到端验证 > 上传包含子目录的项目 | upload 命令 e2e | tests/e2e-cli/upload.test.ts | ✓ |
| file-upload > CLI upload 端到端验证 > 上传空目录 | upload 命令 e2e | tests/e2e-cli/upload.test.ts | ✓ |
| file-upload > 版本管理端到端验证 > 多次上传版本递增 | upload 命令 e2e | tests/e2e-cli/upload.test.ts | ✓ |
| file-upload > 版本管理端到端验证 > 通过 pages info 查看版本历史 | upload 命令 e2e | tests/e2e-cli/upload.test.ts | ✓ |
| page-serving > iframe 包装 > 访问已存在页面的 iframe HTML | page-serving e2e | tests/e2e-cli/serve.test.ts | ✓ |
| page-serving > iframe 包装 > 访问不存在页面 | page-serving e2e | tests/e2e-cli/serve.test.ts | ✓ |
| page-serving > 静态文件服务 > 请求 index.html（无尾部路径） | page-serving e2e | tests/e2e-cli/serve.test.ts | ✓ |
| page-serving > 静态文件服务 > 请求 index.html（带尾部斜杠） | page-serving e2e | tests/e2e-cli/serve.test.ts | ✓ |
| page-serving > 静态文件服务 > 请求子目录中的静态文件 | page-serving e2e | tests/e2e-cli/serve.test.ts | ✓ |
| page-serving > 静态文件服务 > 请求不存在的文件 | page-serving e2e | tests/e2e-cli/serve.test.ts | ✓ |
| page-serving > SPA Fallback > SPA 子路由回退到 index.html | page-serving e2e | tests/e2e-cli/serve.test.ts | ✓ |
| page-serving > SPA Fallback > 有扩展名的缺失文件不触发 fallback | page-serving e2e | tests/e2e-cli/serve.test.ts | ✓ |
| page-serving > 安全头 > CSP 头设置 | page-serving e2e | tests/e2e-cli/serve.test.ts | ✓ |
| cli-tool > CLI pages 子命令 > 列出页面 | pages e2e | tests/e2e-cli/pages.test.ts | ✓ |
| cli-tool > CLI pages 子命令 > 查看页面详情 | pages e2e | tests/e2e-cli/pages.test.ts | ✓ |
| cli-tool > CLI pages 子命令 > 删除页面 | pages e2e | tests/e2e-cli/pages.test.ts | ✓ |
| cli-tool > CLI pages 子命令 > 删除不存在的页面 | pages e2e | tests/e2e-cli/pages.test.ts | ✓ |
| cli-tool > CLI schemas 子命令 > 创建 schema | schemas e2e | tests/e2e-cli/schemas.test.ts | ✓ |
| cli-tool > CLI schemas 子命令 > 列出 schemas | schemas e2e | tests/e2e-cli/schemas.test.ts | ✓ |
| cli-tool > CLI schemas 子命令 > 删除 schema | schemas e2e | tests/e2e-cli/schemas.test.ts | ✓ |
| cli-tool > 完整工作流 > new → upload → pages info → serve 完整流程 | 完整工作流 e2e | tests/e2e-cli/workflow.test.ts | ✓ |

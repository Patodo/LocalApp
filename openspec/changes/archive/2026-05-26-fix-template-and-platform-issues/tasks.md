## 1. 模板 vite.config.ts 添加 base 配置

- [x] 1.1 [RED] 验证当前 `init-repo/vite.config.ts` 未设置 `base`，构建产物 `dist/index.html` 资源引用为绝对路径
- [x] 1.2 [GREEN] 在 `init-repo/vite.config.ts` 添加 `base: "./"`
- [x] 1.3 [VERIFY] 执行 `npm run build`（在 init-repo/ 内），确认 `dist/index.html` 中 `<script>` 和 `<link>` 使用 `./assets/...` 相对路径
- [x] 1.4 [COMMIT] 提交模板 vite 配置修改

## 2. 模板 CLAUDE.md 补充文档约定

- [x] 2.1 [RED] 读取当前 `init-repo/CLAUDE.md`，确认无 ESM import `.js` 扩展名说明、useMe 示例含误导性 `error.status === 401`、无 useAgent 闭包说明
- [x] 2.2 [GREEN] 在 CLAUDE.md 的 SDK 参考章节开头添加 TypeScript ESM import 约定（".js 扩展名必须显式写出"）
- [x] 2.3 [GREEN] 修正 useMe 的错误处理示例：`me === null` 替代 `error.status === 401`
- [x] 2.4 [GREEN] 在 Agent SDK 章节添加 useAgent 闭包模式说明（`optionsRef.current` 机制，自动获取最新闭包）
- [ ] 2.5 [VERIFY] 用全新 Agent 在 /tmp 目录执行 `localapp init` → `npm install` → `npm run build` 流程，确认 Agent 未因 import 扩展名或 useMe 错误处理问题报错
- [x] 2.6 [COMMIT] 提交 CLAUDE.md 文档更新

## 3. 模板 Agent 工具 Skill 补充闭包安全性说明

- [x] 3.1 [GREEN] 在 `init-repo/.claude/skills/agent-tool-patterns/SKILL.md` 补充 "工具函数闭包安全性" 章节，解释 `optionsRef.current` 延迟引用模式
- [x] 3.2 [VERIFY] 确认 Skill 文件中新增章节清晰说明：每次重渲染工具函数自动获取最新闭包，无需手动 useCallback 包裹
- [x] 3.3 [COMMIT] 提交 Agent skill 文档更新

## 4. Server: /serve/:userId/:name 无尾斜杠 301 重定向

- [x] 4.1 [RED] 在 `packages/server/tests/e2e-cli/serve.test.ts` 添加测试用例：`GET /serve/:userId/:name`（无尾斜杠）应返回 301，Location 为带尾斜杠路径
- [x] 4.2 [GREEN] 在 `packages/server/src/routes/serve.ts` 的 `/serve/:userId/:name` 路由中添加 `req.url` 检查，无尾斜杠时 `reply.redirect(301, ...)` 到带尾斜杠路径，保留查询参数
- [x] 4.3 [REFACTOR] 检查访问控制在重定向前是否正确执行（仅检查 pageAccess 不检查 meta，因为重定向不访问内容）
- [x] 4.4 [VERIFY] 运行 `npx vitest serve.test.ts` 确认新测试通过，手动 `curl -v` 验证 301 行为
- [x] 4.5 [COMMIT] 提交 server 301 重定向修改

## 5. CLI init 输出 shell wrapper 格式 URL

- [x] 5.1 [RED] 在 `packages/server/tests/e2e-cli/init.test.ts` 或相关测试中添加断言：`localapp init` 成功后 stdout JSON 的 `url` 字段为 `/{userId}/{name}/` 格式
- [x] 5.2 [GREEN] 修改 CLI Rust 源码中 init 命令的输出逻辑，`url` 字段改为 shell wrapper 路径（`http://{host}/{userId}/{name}/`）而非 `/serve/` 路径
- [x] 5.3 [VERIFY] 编译 CLI，运行 `localapp init --name test-app` 验证输出 URL 格式正确
- [x] 5.4 [COMMIT] 提交 CLI init 输出修改

## 6. 端到端验证

- [x] 6.1 重建模板并验证：执行 `localapp init --name verify-app`，检查 `vite.config.ts` 含 `base: "./"`
- [x] 6.2 在 verify-app 中 `npm install && npm run build`，确认 dist 资源引用为相对路径
- [x] 6.3 上传并访问 `http://localhost:3000/testuser/verify-app/`（shell wrapper 格式），确认资源正常加载无 404
- [x] 6.4 访问无尾斜杠 URL `http://localhost:3000/serve/testuser/verify-app`，确认 301 重定向到带尾斜杠路径后资源正常加载
- [x] 6.5 运行现有全量 e2e 测试（`npx vitest` e2e-cli 套件 + `npx playwright test` e2e-ui 套件），确认无回归
- [x] 6.6 [COMMIT] 如有清理性修改，提交最终变更

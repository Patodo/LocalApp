## Why

通过一次全新的零上下文 Agent 开发体验，发现模板项目和平台本身存在多个阻碍新用户首次成功部署的问题。最严重的是模板构建产物在平台上资源 404（白屏），以及无尾部斜杠访问时资源路径解析错误。这些问题使得从 `localapp init` 到看到可运行应用的过程中存在断点。

## What Changes

- **Vite 构建使用相对路径**：模板 `vite.config.ts` 默认添加 `base: "./"`，确保构建产物在 `/serve/{user}/{page}/` 路径下正确加载
- **无斜杠 URL 自动重定向**：`/serve/:userId/:name`（无尾斜杠）→ 301 重定向到 `/serve/:userId/:name/`（带尾斜杠），解决相对路径资源解析问题
- **CLI 输出快捷 URL**：`localapp init` 成功后打印 `http://{host}/{userId}/{page}/` 格式的快捷链接（shell wrapper 路径），而非 `/serve/...` 路径
- **模板 CLAUDE.md 补充关键信息**：显式标注 `.js` 扩展名 import 要求、`useAgent` 工具闭包模式说明、Agent 工具编写最佳实践补充
- **API 行为一致性**：`/api/me` 在无 session 时返回 401 而非 200 + null（**BREAKING** — 但当前 SDK 已兼容两种行为）

## Capabilities

### New Capabilities
<!-- 本次不引入全新 capability -->

### Modified Capabilities
- `init-template`: 模板 vite.config.ts 添加 `base: "./"`，CLAUDE.md 补充 import 约定和 Agent 模式
- `page-serving`: `/serve/:userId/:name` 无尾斜杠时 301 重定向到带尾斜杠路径
- `user-auth`: `/api/me` 无 session 时统一返回 401
- `cli-tool`: `init` 成功后打印 shell wrapper 格式的快捷 URL

## Impact

- 模板 `vite.config.ts` — 添加 `base: "./"`
- 模板 `CLAUDE.md` — 补充 ESM import 约定、useAgent 闭包模式
- 模板 `.claude/skills/agent-tool-patterns/` — 补充闭包安全性说明
- `packages/server/src/routes/serve.ts` — 添加无尾斜杠的 301 重定向
- `packages/server/src/routes/auth.ts` — `/api/me` 异常流修改
- `packages/cli/src/` — init 命令输出信息调整
- `packages/client/src/` — useMe hook 可能需要微调（当前已兼容 null/401 两种响应）

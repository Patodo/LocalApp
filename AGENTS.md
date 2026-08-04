# LocalApp 主项目

## 测试方法

端到端验证 Agent 功能时，按以下步骤操作：

1. **启动 server** — 在本项目目录运行 `npm run dev`（等同于 `npm run dev:server`）
2. **初始化测试应用** — 在临时目录用 CLI 的 builtin init-repo 模板初始化一个应用：
   ```bash
   mkdir -p /tmp/localapp-test && cd /tmp/localapp-test
   localapp init  # 使用 builtin 模板
   ```
3. **用 Codex 实现应用** — 在初始化的目录中使用 bash 工具结合 Codex 的 prompt 参数，让 Codex 按照 init-repo/.Codex/skills/ 中的 skill 指引实现应用：
   ```bash
   Codex --print "实现一个请假表单应用..." < prompt.txt
   ```
4. **上传到 server** — 使用 CLI 上传构建产物：
   ```bash
   localapp upload
   ```
5. **回到本项目检查** — 回到 localapp 主项目目录，使用 chrome-devtools MCP 工具访问 `http://localhost:3000/{user}/{app}/`，验证应用功能和 agent 行为。`/serve/{user}/{app}/` 仅用于 raw app resource/API 诊断。

## 导航栏设计

平台 Shell 导航栏（`buildPlatformShell()`）采用左右分区设计：

- **左侧** — 关联应用的操作：应用名称、Issue 按钮
- **右侧** — 关联用户的操作：主页入口、收藏按钮、头像、登录/登出等

添加导航栏新功能时，按此原则决定放置位置。

## 图标使用

项目统一使用 [Lucide](https://lucide.dev/) 图标库：

- **React SPA**（admin、profile）— 使用 `lucide-react`，按需引入：`import { House } from "lucide-react"`
- **Server 端页面**（serve.ts 中的 HTML 模板）— 使用 Lucide 图标的 inline SVG（24x24 viewBox, stroke-width 2, stroke="currentColor"）

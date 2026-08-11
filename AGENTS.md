# LocalApp 主项目

## 测试方法

端到端验证 Agent 和应用功能时，所有生成项目、Server 数据、上传文件和下载文件都放在本仓库的 `tmp/` 下：

1. **启动统一 Server** — 在本项目目录运行 `npm run dev`（等同于 `npm run dev:server`）。
2. **初始化测试应用** — 使用 CLI 的 builtin 模板在 `tmp/` 下创建项目：
   ```bash
   mkdir -p tmp/localapp-test && cd tmp/localapp-test
   localapp init  # 使用 builtin 模板
   ```
3. **实现应用** — 遵循生成项目中的 `AGENTS.md` 和 `.claude/skills/localapp*/`。
4. **安装到明确的 Server** — 构建并安装应用包：
   ```bash
   localapp check --json
   localapp app install --target local
   ```
5. **正式入口验证** — 使用 `browser:control-in-app-browser` 访问 Server 返回的 `/<owner>/<app>/` URL，检查 DOM、console、核心读写和权限边界。`/serve/<owner>/<app>/` 只用于 raw app resource/API 诊断，不能作为功能验收入口。

本地应用临时产物不得写入系统 `/tmp`；测试结束后只清理本项目 `tmp/` 下本次创建的明确目录。

## 导航栏设计

平台 Shell 导航栏（`buildPlatformShell()`）采用左右分区设计：

- **左侧** — 关联应用的操作：应用名称、Issue 按钮
- **右侧** — 关联用户的操作：主页入口、收藏按钮、头像、登录/登出等

添加导航栏新功能时，按此原则决定放置位置。

## 图标使用

项目统一使用 [Lucide](https://lucide.dev/) 图标库：

- **React SPA**（admin、profile）— 使用 `lucide-react`，按需引入：`import { House } from "lucide-react"`
- **Server 端页面**（serve.ts 中的 HTML 模板）— 使用 Lucide 图标的 inline SVG（24x24 viewBox, stroke-width 2, stroke="currentColor"）

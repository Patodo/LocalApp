# LocalApp 主项目

## 当前架构边界

- 用户只安装一个 `localapp` npm 包；它提供唯一 TypeScript CLI、统一 Server 的前台/daemon 模式、模板与按平台 native adapter。
- `localapp server` 管理当前用户 daemon，`localapp server run` 以前台模式运行同一 Server；不要新增第二套本地后端或独立 Server launcher。
- native adapter 只负责 `localapp://`、系统通知及必要的操作系统注册；安全判断、动作执行、应用托管和数据能力都属于 Server。
- 不要恢复独立原生 CLI、Desktop/Tauri package、托盘界面或 Local Runtime 产品边界。

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

## 实时协作边界

- `@localapp/crdt` 是 builtin template 内的可选包；统一 Server 负责 CRDT 更新的认证、授权、持久化和传输，不要引入应用私有协作后端。
- Awareness 是短期在线状态，不进入数据库、备份或 peer 数据同步；正式数据与 verification session 必须使用隔离事件 channel。
- “谁正在编辑什么”的遮罩由 Platform Shell 根据应用声明的 `data-localapp-edit-surface` / `data-localapp-edit-field` 绘制。应用不得传任意 CSS selector、用户身份或颜色，遮罩不得拦截应用交互。

## 图标使用

项目统一使用 [Lucide](https://lucide.dev/) 图标库：

- **React SPA**（admin、profile）— 使用 `lucide-react`，按需引入：`import { House } from "lucide-react"`
- **Server 端页面**（serve.ts 中的 HTML 模板）— 使用 Lucide 图标的 inline SVG（24x24 viewBox, stroke-width 2, stroke="currentColor"）

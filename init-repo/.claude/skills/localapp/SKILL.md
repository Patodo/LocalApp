---
name: localapp
description: >
LocalApp 统一 Server 应用的开发与部署指南。当用户提到 localapp、部署前端页面、
创建托管项目、安装应用包，或当前目录包含 manifest.json 时使用此 skill。
  也适用于用户说"部署一下"、"上传页面"、"创建项目"、"init 项目"、
  "帮我做一个 xxx 应用"等场景。即使用户没有明确说 localapp，
  只要涉及在 LocalApp 平台上开发或部署，都应使用此 skill。
---

# LocalApp

介于低代码与高度自定义之间的应用平台，内置 named SQL、用户身份、内容上传和正式路径隔离验收。所有部署都是同一个 Server；目标不是“构建成功”，而是让用户创建应用后立即在正式入口看到可用结果。

## 项目识别

操作前先检查 `manifest.json`：

```json
{
  "name": "my-app",
  "distDir": "dist",
  "db": { "mode": "crud" },
  "platformVersion": "^1.2",
  "requires": {
    "backend": "named-sql",
    "identity": ["currentUser", "pageOwner"]
  }
}
```

- 有 `manifest.json` → 已是 LocalApp 项目，直接操作
- 没有 → 提示用户先 `localapp init --name <name>`

## 开发与验收闭环

必须区分四个状态，不能因为前一个状态成功就宣称应用可用：

| 状态 | 证据 | 可以宣称什么 |
|---|---|---|
| 本地检查通过 | `localapp check --json` 的 `success=true` | 项目满足当前平台契约 |
| 已部署 | `deployment.status=deployed` | 指定版本已经写入平台 |
| 待浏览器验收 | `verification.status=pending-browser` | 正式 HTTP/API smoke 通过，仍需体验 |
| 正式验收通过 | 正式 URL 的 DOM、console、交互、身份检查全部通过并成功提交报告 | 应用在正式入口可用 |

首次创建项目：
```bash
localapp init --name my-app        # 生成 Vite + React 项目骨架
cd my-app
npm install
localapp dev                       # 本地开发和多身份/时间/数据验证
localapp check --json              # 本地契约、测试、构建和 dist 门禁
localapp app install --target local # 构建并安装到本机 Server
```

后续更新：
```bash
localapp check --json && localapp app install --target local
```

只有用户明确要求团队共享或远端部署时，才执行：

```bash
localapp server add company --url https://localapp.example.com
localapp server login company
localapp app install --target company
```

`app install` 返回正式路径后，必须用应用内 Browser 访问 `/<owner>/<app>/`，并检查：

1. DOM 有实际业务内容且无错误占位。
2. console 没有未处理错误。
3. 至少一条核心读取和写入/状态流转交互可用。
4. owner 身份及权限边界符合预期；有成员场景时再运行 `localapp verify --as member --json`。
5. 通过 `/serve/<owner>/<app>/api/_verification/report` 提交结构化结果。仅报告接口成功接收 `passed` 后才称为“正式验收通过”。

正式验收只能访问 `/<owner>/<app>/` 或命令返回的 `browserUrl`。`/serve/<owner>/<app>/` 是 raw resource/API 诊断入口，不代表用户实际体验。

### 平台配置覆盖

成功部署后，平台保存应用上传的 `manifest.json` 快照。应用所有者可在 `/my/apps/<app>/settings` 维护独立的 `manifest.platform.json`：

- 运行时 `manifest.platform.json` 优先，缺失字段回退到 `manifest.json`。
- 后续 `localapp app install --target <name>` 更新应用自带 manifest，但不会覆盖平台配置。
- 设置页切到“应用自带配置”时所有 manifest 控件只读。
- 本阶段平台只允许覆盖描述、页面访问、Shell、数据库权限和通知配置。
- 线上行为与本地 manifest 不一致时，先检查平台配置，不要直接修改 raw `/serve/` 资源。

应用数据库备份、导入导出和恢复出厂设置位于同一设置页的数据管理页签。导入、恢复和恢复出厂设置会先创建安全备份；恢复出厂设置不会删除应用或版本。

## 通用 Device Actions

当应用需要在当前点击按钮的电脑上执行本机操作时，只调用 SDK 的 `device.run()`，不要为某个应用或某个外部工具扩展 Server API。激活前展示操作和最小权限；默认关闭网络和子进程权限，`childProcess` 等价于当前操作系统用户权限下的任意代码执行。脚本只接收结构化输入，校验相对路径/大小边界并返回有限大小的 JSON 结果。`localapp://` 只传递短期激活票据，不传脚本、依赖、凭据或用户数据。完整示例见 `localapp-device-actions` skill。

## 媒体预览基础设施

模板固定 `react-pdf@10.4.1`、`pdfjs-dist@6.1.200` 和 `yet-another-react-lightbox@3.32.1`。PDF 预览用 `Document` / `Page` 配置已安装的 PDF.js worker，包含 loading、错误和页码导航；图片预览提供 alt 文本、键盘导航和下载。所有本地 object URL 在文件变化或组件卸载时调用 `URL.revokeObjectURL()`。上传继续使用 `useUpload()` 和 authenticated content URL，预览不读取 raw `/serve/` 资源。

## CLI 命令参考

### 认证
```bash
localapp login                     # 配置 server URL + API key
```
也支持环境变量 `LOCALAPP_SERVER_URL` 和 `LOCALAPP_API_KEY`（优先级高于配置文件）。

### 项目管理
```bash
localapp init --name <name>        # 创建项目（--description 可选）
localapp build --package           # 构建并生成 .localapp（需要单独查看包时使用）
localapp app install --target <name> # 构建并安装/更新到明确的 Server profile
localapp app sync --peer <name>    # 在对等 Server 间同步应用版本
localapp app sync --peer <name> --with-data --confirm-app <exact-name> # 显式替换应用和数据
localapp check --json              # 安装前结构化门禁
localapp verify --as owner --json  # 对已部署版本单独发起 owner 验收
localapp verify --as member --json # 对已部署版本单独发起 member 验收
```

### Server profiles
```bash
localapp server add <name> --url <url>
localapp server list
localapp server use <name>
localapp server login <name>
localapp server remove <name>
```

### 页面管理
```bash
localapp pages list                # 列出所有页面
localapp pages info [name]         # 查看页面详情
localapp pages delete [name]       # 删除页面
```

### DB / Migration
```bash
localapp db reset                 # 重建本地 dev.db，应用 migrations 和 dev seed
localapp db validate              # 拉生产快照验证 pending migrations
localapp db status                # 查看已应用/待应用 migrations
localapp db restore --backup v1   # 从 server backup 恢复 app.db
localapp db types -o src/types.ts # 从 dev.db 生成 TypeScript 类型
```

### Backend Contract
```bash
localapp backend scaffold --security-profile authenticated
                                  # 默认安全主路径：登录用户可访问
localapp backend scaffold --security-profile owner --identity-field created_by
                                  # 记录所有者隔离主路径
                                   # ($<table>.list/get/count + create/update/delete)
localapp backend scaffold --force # 覆盖已存在的 backend/resources/<table>/ 声明
localapp backend scaffold --table work_items  # 仅生成指定表
```

scaffold 会生成带摘要的安全契约。优先选择 `authenticated`、`owner`、`member` 或 `parent-owner` profile；只有预置 profile 无法表达业务时才使用 `security.mode=custom`，并补齐场景验证元数据。生成后仍需按业务调整状态守卫和结果上限。

表结构通过 `migrations/001_<description>.sql`、`002_<description>.sql` 管理，不再使用 `localapp schemas` 命令族。

### 其他
```bash
localapp update                    # 自更新 CLI
```

## 数据模式

LocalApp 支持两种数据操作模式，通过 `manifest.json` 的 `db.mode` 配置：

### CRUD 模式（默认）
写 SQL migration 创建表 → 自动获得 REST API + React Hook。不需要写后端代码。

```sql
CREATE TABLE posts (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL);
```

前端直接用 SDK Hook（详见 `localapp-data` skill）：
```tsx
const { rows, refresh } = useList("posts");
const { create } = useCreate("posts");
```

SDK 自动处理 API 路由（开发时通过 vite proxy，线上通过 native shell 的同页运行路径），无需手动拼接 URL。
- `GET` 列表/详情、`POST` 创建、`PUT` 更新、`DELETE` 删除、`GET /count` 计数

### SQL 模式

> **raw SQL 端点（`/api/db/exec`）和 `useExec` Hook 已移除**（restrict-app-api-to-named-sql
> 变更）。应用必须把所有数据操作声明为 named SQL，通过 `useQuery` / `useMutation`
> 或 `client.query` / `client.mutate` 调用。

复杂数据查询通过声明 named query 实现：

```json
// backend/resources/posts/queries.json
{
  "queries": {
    "posts.withAuthor": {
      "kind": "query",
      "sql": "SELECT p.*, u.name AS author FROM posts p JOIN users u ON u.id = p.author_id WHERE p.id = :id",
      "params": { "id": { "type": "number", "required": true } },
      "result": { "mode": "single", "maxRows": 1, "maxBytes": 8192 },
      "access": "authenticated"
    }
  }
}
```

```tsx
import { useQuery } from "@localapp/sdk-react";
const { query } = useQuery();
const post = await query("posts.withAuthor", { id: 1 });
```

### DevShell 本地验证

运行 `localapp dev` 时，DevShell 会注入 **Dev Toolkit**：

- Identity：切换 `dev-user` / `alice` / `bob` / 未登录，验证当前用户、`:currentUserId` 注入和 named SQL 的 access 校验。
- Time：切换真实时间或固定 ISO 时间，验证 `:now` 系统变量注入、截止日期和进度视图。
- Data：reset `.localapp/dev.db`，创建/恢复 snapshot；reset 会重新应用 migrations 和 `db/seeds/dev.sql`。
- Diagnostics：查看最近 API 请求和 `manifest.business` 业务规则。

身份、时间、reset/restore 后会触发 `localapp:dev-context-changed`，SDK 数据 hooks 会自动刷新订阅资源。

`localapp dev` 会把开发应用接到当前统一 Server，并将本地验收数据放在项目 `tmp/` 下。应用侧应通过 SDK 调用数据、用户、分组、上传、named SQL 和时间 API；开发 Server 与其他部署使用同一套应用 API 路由契约，避免本地可用、线上不可用或反向漂移。

## 访问控制

两层权限，无需写代码：

**页面级**（谁能看到页面）：
```bash
# PUT /api/pages/<name>  Body: { "pageAccess": { "level": "authenticated" } }
```

**路由级**（谁能操作特定数据）：
```bash
# 在 manifest.business 中指定 recordAccess
{ "read": "public", "create": "authenticated", "update": "owner", "delete": "owner" }
```

级别：`public`（任何人）/ `authenticated`（需登录）/ `owner`（仅所有者）/ `acl`（指定用户列表）

## Guardrails

- 不要上传 `src/`、`node_modules/`、`.env`
- Schema 变更通过新增 SQL migration 管理；上传前运行 `localapp check --json`
- Raw SQL 模式需在 manifest.json 设置 `db.mode: "sql"`
- 部署成功但验收失败时保留 `deployment.status=deployed`，不要把失败误报成“未部署”，也不要盲目重复上传
- stdout 的结构化结果是状态证据；stderr 包含进度日志和最终错误对象

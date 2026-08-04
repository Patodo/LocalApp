# LocalApp App — AI 助手开发指南

## 平台概述

你的应用运行在 LocalApp 平台上——React + TypeScript + Vite，运行在 native shell 中。平台自动处理用户认证和导航。

## 开发工作流

每次修改代码后，默认按顺序执行：

1. `npm run build` — 构建前端
2. `localapp check` — 检查平台契约
3. `localapp build --package` — 生成 `.localapp`
4. `localapp local install` — 安装或更新到 Desktop 本地应用库

个人本地正式运行不要求部署 LocalApp Server。只有用户明确要求团队共享、企业
能力或远端部署时，才配置 Server profile 并执行
`localapp upload --profile <name> --verify`。本地安装与远端发布是两个独立动作，
不会自动同步数据库或文件。

平台会把本次成功上传的完整配置保存为只读的 `manifest.json` 快照。应用所有者还可以在“我的应用 → 设置”维护独立的 `manifest.platform.json`；运行时平台配置优先，未覆盖字段回退到应用自带配置，后续 upload 不会覆盖平台配置。排查本地与线上配置差异时，应在设置页切换查看两份配置。设置页“数据管理”提供生产数据库导出、备份、导入、恢复和恢复出厂设置；恢复出厂设置保留应用与部署版本，只重建空数据库并清除平台配置。

本地安装后从 Desktop 打开应用，验证由 Local Runtime 提供的正式本地形态。
远端发布后使用命令返回的 `/<userId>/<pageName>/` 地址验证 PlatformShell。
自部署开发 Server 的完整示例是
`http://localhost:3000/<userId>/<pageName>/`。
`/serve/<userId>/<pageName>/` 是远端平台内部 raw app resource/API base，只用于
静态资源、SPA fallback 或 API 诊断，不作为应用功能验收入口。

### 本地开发（`npm run dev` / `localapp dev`）

`npm run dev` 会委托给 `localapp dev`，启动本地 mini-server 和 Vite dev server。命令会写入 `.localapp/dev-config.json`，包含：

- `serverUrl` — 远程 server 地址
- `userId` — 当前 API key 对应身份（用于 proxy 路径改写）
- `pageName` — 取自 `manifest.json`
- `apiKey` — 当前登录用户的 API key（**未登录时为空字符串**）
- `miniServerPort` — 本地 mini-server 端口

vite-plugin 读取 dev-config 实现：

- `/api/llm/*` 转发到 `serverUrl`（需要登录/平台连接）
- 其他 `/api/*` 转发到本地 mini-server，读写 `.localapp/dev.db`
- 远端转发请求会自动注入 `X-API-Key` header（值来自 `apiKey`），无需手动处理鉴权
- dev 模式自动注入 DevShell 工具栏（生产构建不含）

**未登录（apiKey 为空）时**：本地应用 API、`useMe()`、`useUsers()`、`useGroups()`、文件上传、named SQL 和平台数据 mock 都应继续可用；只有远端平台数据、上传部署和 AI/LLM 等需要平台鉴权的能力不可用。需要连接平台时再运行 `localapp login`。

#### DevShell 验证工具

`localapp dev` 会在左上角注入 **Dev Toolkit**。开发时优先用它验证本地行为：

- **Identity**：切换 `dev-user` / `alice` / `bob` / 未登录，检查 `defaultFrom: "currentUser.id"`、`recordAccess`、`useMe()` 和权限 UI。
- **Time**：切换真实时间或固定 ISO 时间，检查 transition 的 `"now"`、进度、截止日期和时间相关视图。
- **Data**：重置 `.localapp/dev.db`、创建 snapshot、restore snapshot。reset 会重新应用 migrations 和 `db/seeds/dev.sql`。
- **Diagnostics**：查看最近 API 请求，以及 `manifest.business` 中的 `recordAccess`、`defaultFields`、`transitions`、`enums`。

Dev Toolkit 修改身份、时间或恢复数据后会派发 `localapp:dev-context-changed`，SDK 数据 hooks 会自动刷新订阅资源；通常不需要手动刷新页面。

### 首次拉取项目（团队成员）

clone 仓库后执行 `npm install`，`postinstall` 钩子会自动调用 `localapp sync --quiet` 把 CLI 领地（`.localapp/runtime/` 和 `.claude/skills/localapp*/`）从当前 CLI 二进制抽取到本地。无需手动 sync。

如果本地 runtime 曾被误改，运行 `localapp sync --force` 强制恢复 LocalApp 管理的 runtime 产物。

## CLI 领地（禁止手动修改）

以下目录由 `localapp` CLI 管理，**禁止手动修改**——任何改动都会被 `localapp sync` 覆盖：

- `.localapp/runtime/` — SDK 三件套、DevShell、vite-plugin、tsconfig.base、styles 预设、version.json
- `.claude/skills/localapp*/` 和 `.claude/skills/agent-tool-patterns/` — AI 指引文档

应用仓库的 `scripts/dev.mjs`、同步脚本或测试不得 patch `.localapp/runtime`，也不得自行构建 `.localapp/runtime/server-core`。如果本地 dev 缺平台能力（例如某个 `/api/*` 端点 404），应反馈 LocalApp 平台补齐；临时恢复本地 runtime 时使用 `localapp sync --force`。

如需深度定制这些代码（高级用户），运行 `localapp eject` 一次性把 CLI 领地移出管辖、转为用户代码（不可逆，将失去自动更新）。

## sync / eject 命令

| 命令 | 行为 |
|------|------|
| `localapp sync` | 默认同步模式，显示进度，刷新 CLI 领地到当前 CLI 版本 |
| `localapp sync --quiet` | 静默模式（postinstall 钩子使用），版本一致时输出最简、错误不阻断 |
| `localapp sync --interactive` | 交互模式，显示版本对比和变更清单、询问用户确认 |
| `localapp sync --force` | 强制刷新 CLI 领地，恢复 `.localapp/runtime` 和内嵌 server-core 产物 |
| `localapp sync --off` | 关闭 postinstall 自动 sync（写入 `dev-config.json` 的 `autoSync: false`） |
| `localapp sync --on` | 重新开启自动 sync |
| `localapp eject` | 一次性脱钩：把 CLI 领地移到用户代码下，永久脱离自动更新（不可逆） |

CLI 升级后（运行 `localapp update`），用户运行 `localapp sync --interactive` 或直接 `npm install`（触发 postinstall）即可拿到最新的 SDK / DevShell / skills。

## 核心规则

- **从 SDK 包导入，无需 `.js` 扩展名**: `import { useList } from "@localapp/sdk-react"`
- **优先使用 shadcn/ui 组件**: `import { Button } from "@/components/ui/button"`，全量组件已预置
- **所有表单控件必须有 label 关联**: `<label htmlFor="id">` 对应 `<input id="id" ...>`，包括 `<input type="file">` 也要关联
- **Agent 工具中禁止直接 fetch API**: 用 SDK hooks 或应用通过 `useRegisterTools` 注册的工具，不能 `fetch("/api/...")`
- **先写 SQL migration 再写代码**: 在 `migrations/001_<name>.sql` 中声明表结构，本地用 `localapp db reset` 应用
- **生成 TypeScript 类型**: `localapp db types -o src/types.ts`（从 `.localapp/dev.db` 反向生成 interface）
- **生成 named SQL 脚手架**: 写完 migration 后跑 `localapp backend scaffold`，自动生成 `backend/resources/<table>/{schema,queries,mutations}.json`，然后手动设置 `access` 字段和业务过滤
- **默认用 bounded named SQL 承载读模型**: 普通 CRUD、列表、详情、筛选、分页、统计和聚合优先写在 `backend/resources/<table>/queries.json` / `mutations.json`。query 要声明 `result`，列表用 `mode: "page"` + `LIMIT/OFFSET`，详情用 `single`，统计用 `aggregate`。
- **复杂业务优先沉淀为 named SQL / transaction mutation / 平台原语**: 审批、状态流转、跨表短写入和服务端校验不要只写在 React 里；先用 `backend/resources/<table>/mutations.json` 声明 named mutation，涉及多步原子写入时使用 `client.transaction()` / `useTransaction()` 原子执行多条 registered mutation，或反馈平台补齐原语。不要创建 `backend/actions/`、`actions.manifest.json` 或 `actions.bundle.mjs`，稳定平台已禁用 hosted action。
- **变更操作要 try/catch**: `useCreate`/`useUpdate`/`useDelete` 抛异常时用 `LocalAppError` 判断状态码
- **`useMe` 返回 null 表示未登录**: 检查 `me === null`，不用 `error.status === 401`
- **业务应用建模优先用 `manifest.business`**: 归属、状态、权限写进 `manifest.business`，不要只在 React 里筛数据
- **当前用户字段用 `defaultFrom`**: `created_by`/`reviewed_by` 等字段加 `defaultFrom: "currentUser.id"`，让后端自动填充并防伪造
- **记录级权限用 `recordAccess`**: 在 `manifest.business` 声明，但**后端不再自动执行**——必须在 named SQL 的 WHERE 子句或 access 字段里自己实现。前端用 `usePermissions()` 或 `<Can>` 同步判断 UI
- **业务状态变化用 named mutation + 本地 transitions 元数据**: 在 `manifest.business.<table>.transitions[]` 声明合法迁移（`from`/`to`/`access`）作为前端 UI 提示，在 `backend/resources/<table>/mutations.json` 声明对应的 named mutation（如 `$work_items.approve`）作为实际执行入口——前端用 `useTransitions(resource, record, schema)` 渲染按钮、调用 `transition(name)` 触发 mutate。**不要用 `useUpdate` 改 status 字段**
- **协作编辑能力用 `manifest.collaboration` + 编辑会话注册**: 需要平台保存/协作历史时，在 `manifest.collaboration.resources.<table>` 声明 `mode: "record-versioned"` 和对应 named mutation，并在前端用 `useRegisterEditSession()` 注册当前页面的保存/撤销/重做状态。PlatformShell/DevShell 会在左侧导航承载按钮和快捷键；undo/redo 只撤销当前用户当前标签页的前端会话操作，刷新后清空，不能撤销他人的操作。
- **`usePermissions()` 仅用于 UI 展示**: 后端 CRUD API 才是权限的安全边界
- **不要调用 hosted action**: `client.action()` / `useAction()` 仅保留为 legacy/unsupported helper；稳定应用应使用 `client.query()`、`client.mutate()`、`useQuery()`、`useMutation()` 或平台明确提供的原语。
- **`src/main.tsx` 必须只渲染 `<App />`**: DevShell 由 vite-plugin 在 dev 模式自动注入，生产构建不进入 bundle。**不要在 main.tsx 中 import 或包裹 DevShell**——否则会破坏 dev/prod 隔离，导致生产构建包含 DevShell 工具栏
- **禁止修改 CLI 领地**: `.localapp/runtime/` 和 `.claude/skills/localapp*/` 由 `localapp sync` 管理，手动改动会被覆盖；不要从应用脚本 patch runtime 或构建 `.localapp/runtime/server-core`，需要恢复时运行 `localapp sync --force`

## SDK 快速上手

SDK 位于 `packages/sdk-core/` 和 `packages/sdk-react/`，通过 npm 包安装后使用。所有 Hook 从 `@localapp/sdk-react` 导入，客户端从 `@localapp/sdk` 导入。

### 列表 + 创建

```tsx
import { useList, useCreate } from "@localapp/sdk-react";

function TodoApp() {
  const { rows, loading, error, refresh } = useList<Todo>("todos");
  const { create } = useCreate<Todo>("todos");

  if (error) return <p>加载失败: {error.message}</p>;
  if (loading) return <p>加载中...</p>;

  return (
    <div>
      <form onSubmit={async (e) => {
        e.preventDefault();
        const input = (e.target as HTMLFormElement).elements[0] as HTMLInputElement;
        await create({ title: input.value, done: false });
        input.value = "";
        refresh();
      }}>
        <label htmlFor="title">标题</label>
        <input id="title" name="title" required />
        <button type="submit">添加</button>
      </form>
      <ul>{rows.map(t => <li key={t.id}>{t.title}</li>)}</ul>
    </div>
  );
}
```

useList options: `{ filters, offset, limit, sort, order }`
useGet: `{ row } = useGet("posts", id)`
useUpdate: `{ update, loading, error } = useUpdate("posts")` → `await update(id, {...})`
useDelete: `{ remove, loading, error } = useDelete("posts")` → `await remove(id)`
useCount: `{ count, loading, error, refresh } = useCount("posts", { status: "published" })`

**onSuccess 回调**：mutation hooks 支持可选的 `onSuccess` 回调，在操作成功后自动执行（如刷新列表）：
```tsx
const { create, loading, error } = useCreate<Todo>("todos", { onSuccess: () => refresh() });
const { update, loading, error } = useUpdate<Todo>("todos", { onSuccess: () => refresh() });
const { remove, loading, error } = useDelete("todos", { onSuccess: () => refresh() });
```

**筛选运算符**：filters 支持后缀运算符实现范围查询：
```tsx
const { rows } = useList("expenses", { filters: { date__gte: "2026-05-01", date__lte: "2026-05-31" } });
// 支持: __gte, __lte, __gt, __lt, __ne, __like
```

### 服务端可信业务逻辑

LocalApp 的稳定后端路线是 named SQL-first。普通读模型、列表、详情、筛选、统计和聚合写入 `backend/resources/<name>/queries.json`；写操作、状态流转和短事务写入 `backend/resources/<name>/mutations.json`。前端只调用注册好的名称，不传 SQL 文本。

```ts
await client.mutate("$leave_requests.approve", {
  id,
  approverId: currentUserId,
});

await client.transaction([
  { name: "$leave_requests.approve", params: { id, approverId: currentUserId } },
  { name: "$audit_logs.create", params: { targetId: id, message: "approved" } },
]);

// 后续 mutation 需要引用前一步 create 的 ID 时:
import { transactionResult } from "@localapp/sdk";

await client.transaction([
  { name: "$work_items.create", params: { title: "新工作项" } },
  {
    name: "$work_item_stages.create",
    params: { work_item_id: transactionResult(0, "lastInsertRowId"), stage_name: "开发" },
  },
]);
```

当逻辑无法用 bounded named SQL 或 named mutation 表达时，不要退回到 hosted action。请在反馈中说明需要的平台能力，例如 batch import、transaction mutation、跨表约束、通知原语或服务端校验原语，由平台侧补齐稳定能力后再实现。

### 协作编辑与安全边界

需要多人协作、修改历史或统一保存入口的应用，应同时使用 `manifest.collaboration` 和编辑会话注册：

- `manifest.collaboration.resources.<resource>` 声明可协作资源、`mode: "record-versioned"` 和用于保存的 named mutation。
- 前端注册当前页面的 `canSave`、`canUndo`、`canRedo`、`busy` 与 `onSave`/`onUndo`/`onRedo` 回调；PlatformShell 和 DevShell 会在左侧导航显示保存、撤销、重做，并绑定快捷键。
- undo/redo 只属于当前用户、当前浏览器 tab 的前端内存会话；刷新后清空，不写入后端，也不能撤销其他用户的提交。
- 协作保存、undo 后的保存、历史恢复和冲突解决都必须被当作新的写操作，重新走当前用户身份、权限检查和 named mutation。
- 协作 API 不接受 raw SQL、任意表名或任意 patch。所有数据库写入必须映射到上传时已经声明并通过校验的 backend contract。
- 其他客户端只接收服务端已提交的 `collab:operation_committed` 事件。若本地已有草稿，应更新 server snapshot 或提示远端更新，不要静默覆盖 localDraft。

### 用户身份

```tsx
import { useMe } from "@localapp/sdk-react";
import { redirectToLogin } from "@localapp/sdk";

const { me, loading } = useMe();
// me: { id: string, name: string } | null — null = 未登录
// redirectToLogin() — 请求当前 Shell 原地打开登录框，成功后返回当前应用
```

### 文件上传

```tsx
import { useUpload } from "@localapp/sdk-react";

const { upload, loading } = useUpload();
const result = await upload(file);  // { key: string, url: string }
// 支持: png/jpg/jpeg/gif/webp/svg, ≤10MB
// Ctrl+V 粘贴: ClipboardEvent.items → type.startsWith("image/") → getAsFile() → upload()
```

## 部署注意事项

- **上传目录结构**: `localapp upload` 自动保留 `dist/` 下的子目录结构（如 `assets/`）。如果手动调用上传 API，需要为每个文件提供 `filepath_N` 字段来保留目录层级。
- **自定义查询**: 生产应用把所有数据 SQL 注册到 `backend/resources/<name>/queries.json` / `mutations.json`，前端用 `client.query()`、`client.mutate()`、`useQuery()` 或 `useMutation()` 调用。**没有 raw SQL 端点**——所有数据操作必须声明为 named SQL。

## SQL Migration 数据建模

```bash
mkdir -p migrations
# 新项目从 001 开始，后续递增：002_add_status.sql、003_add_index.sql
```

示例 migration:
```sql
CREATE TABLE posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  views INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

常用命令:
```bash
localapp db reset                 # 重建本地 .localapp/dev.db，并执行 db/seeds/dev.sql（如存在）
localapp db types -o src/types.ts # 从 dev.db 生成 TypeScript interface
localapp db validate              # 上传前拉取生产快照并验证 pending migrations
localapp db status                # 查看已应用/待应用 migrations
localapp backend scaffold         # 从 migrations 生成标准 named SQL CRUD 契约
                                   # （$<table>.list/get/count + create/update/delete）
localapp backend scaffold --force # 覆盖已存在的 backend/resources/<table>/ 声明
```

`localapp backend scaffold` 是脚手架起点：对每张用户表生成标准 named SQL 模板（包含分页 list、single get、aggregate count，以及 create/update/delete mutation；`access` 字段需手动填）。生成后按业务需要修改 SQL（加 WHERE 过滤/状态守卫/权限校验）、`access` 字段和 `result` 预算。

不要再使用 `localapp schemas create/list/delete/types`；这些命令已废弃。表结构由 SQL migration 管理，应用级后端接口、查询和业务权限写在 `backend/resources/<name>/` 契约文件中。

## Agent SDK

SDK 提供 AI 对话组件，可嵌入页面。

```tsx
import { useAgent, AgentChat } from "@localapp/sdk-agent";

const agent = useAgent({
  tools: {
    fillForm: {
      description: "填写表单字段",
      parameters: { field: { type: "string", required: true }, value: { type: "string", required: true } },
      execute: async (args) => {
        setFormData(prev => ({ ...prev, [args.field as string]: args.value }));
        return `已填写 ${args.field}`;
      },
    },
  },
  systemHint: "这是一个 xxx 应用",
});
// agent: { send, messages, isRunning, error }

<AgentChat agent={agent} />
```

系统自动注册的只读工具: `getCurrentUser`

自定义工具 **必须通过 SDK hooks 执行写操作**，不能直接 fetch。execute 函数自动获取最新的 React 闭包值，无需 useCallback。

## 深入指南

以下 skills 提供完整 API 参考和更多模式——需要时主动读取:

| Skill 文件 | 内容 | 何时读取 |
|---|---|---|
| `.claude/skills/localapp-ui.md` | shadcn/ui 全量组件、基础组件优先、复杂组件使用边界、业务界面模式 | 美化界面/构建 UI |
| `.claude/skills/localapp.md` | CLI 命令、部署流程、manifest.json 配置、数据模式 | 创建/部署项目 |
| `.claude/skills/localapp-data.md` | CRUD Hook 完整 API、Schema 字段参考、业务模型元数据、记录级权限、named SQL | 数据操作 |
| `.claude/skills/localapp-business.md` | 业务应用建模指南、申请/审批/分配/目录类模型、字段约定、`business` 元数据、记录级访问策略 | 业务建模（请假、报销、任务、审批等带归属和状态的应用） |
| `.claude/skills/localapp-transitions.md` | 状态流转（transitions）建模、`business.transitions[]` 元数据、`useTransitions()` Hook 本地计算 + named mutation 执行、提交/审批/驳回/完成等状态变化 | 实现业务状态变化（提交、审批、流转、状态机按钮） |
| `.claude/skills/localapp-auth.md` | `useMe`/`useUsers`/`useGroups` 详解、权限控制、`usePermissions`/`<Can>`、ACL、群组 | 认证/权限 |
| `.claude/skills/localapp-upload.md` | `useUpload` 完整 API、粘贴上传、文件类型/大小限制 | 文件上传 |
| `.claude/skills/localapp-notify.md` | 通知能力 manifest 配置、三层权限模型（owner/notifiers 表/自定义 SQL）、notify 端点调用 | 给订阅者推送通知 |
| `.claude/skills/agent-tool-patterns/SKILL.md` | Agent 工具编写模式、表单填写助手、闭包安全性 | Agent 工具开发 |

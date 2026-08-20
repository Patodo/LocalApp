# LocalApp 应用开发约定

本仓库是一个由统一 LocalApp Server 托管的 React / TypeScript 应用。应用只维护界面、migration、backend contract 和业务规则；用户、登录、权限、文件、通知、Issue、备份和同步由 Server 提供。

## 标准工作流

```bash
npm install
localapp dev
localapp check --json
localapp app install --target local
```

`localapp dev` 用于开发；`check` 必须在发布前通过；`app install` 会构建并安装到明确的 Server profile。远端发布使用同一流程：

```bash
localapp login https://localapp.example.com --api-key <key> --profile production
localapp app install --target production
```

CLI profile 保存目标 Server 的 API Key。应用源码、Scheme URL、浏览器日志和提交记录中不得出现 API Key。

## 验收入口

正式应用 URL 是 `/<owner>/<app>/`（完整形态为 `http://<server-origin>/<userId>/<pageName>/`）。必须从该入口验证 Platform Shell、登录态、DOM、console、核心读写和权限边界。`/serve/<owner>/<app>/` 是 raw app resource/API base，只用于诊断，不作为应用功能验收入口。

最终本地验收使用 `browser:control-in-app-browser`。所有生成项目、Server 数据、上传和下载文件放在仓库 `tmp/` 下，不写系统临时目录。

## 托管模板

`.localapp/runtime/` 与 `.claude/skills/localapp*/` 由 CLI 管理，不要手工 patch：

```bash
localapp sync-template
localapp sync-template --quiet
```

需要永久自行维护时运行 `localapp eject-template`。该操作不可逆；完成后不能再次同步托管模板。

## 数据与后端契约

LocalApp 是 named SQL-first 平台：优先使用注册的 query、mutation 和 transition。不要创建 `backend/actions/` 作为 raw SQL 或任意服务端代码逃生口；平台原语不足时，应反馈平台补齐原语。

先写 `migrations/*.sql`，再维护 `backend/resources/<resource>/`：

```text
backend/resources/<resource>/
├── schema.json
├── queries.json
└── mutations.json
```

- Query 只做参数化读取、分页和聚合。
- Mutation 承载经过权限检查的写入；多步写入使用事务 mutation。
- `access`、参数 schema、SQL 和 result budget 都是契约的一部分。
- 业务表必须保存资源 owner 字段，并让 contract 按登录用户过滤。
- 不要拼接 SQL，不要信任浏览器传入的 owner、角色或文件路径。
- migration 和 contract 的一致性由 `localapp check` 验证。

## 业务建模与状态流转

实现申请、审批、分配、目录等业务应用前，先阅读业务应用建模 skill：`.claude/skills/localapp-business/SKILL.md`。明确 owner、参与者、状态字段、记录级访问和允许的操作后，再写 UI。

业务状态变化使用 Server transition API，不用普通 update 绕过状态机。状态流转、按钮可见性和权限规则见 `.claude/skills/localapp-transitions/SKILL.md`。

## SDK 与身份

只从 `@localapp/sdk` 或 `@localapp/sdk-react` 使用平台能力。不要硬编码 Server origin、用户 ID、`/serve/` 前缀或认证 header。

- 未登录时显示明确登录入口。
- owner-only、member 和 public 行为分别验证。
- 页面上的缓存与 localStorage 不能替代 Server 权限。
- 通知先进入 Web 收件箱；应用只创建平台通知，不直接调用系统通知 API。

## 实时协作

普通业务记录优先使用 named SQL；需要 revision 冲突提示时使用 `record-versioned`。文本、富文本、白板等必须自动合并时才启用可选 `@localapp/crdt`，并先阅读 `.claude/skills/localapp-collaboration/SKILL.md`。

CRDT 应用声明 `platformVersion: ^1.3`、`requires.primitives` 和 `manifest.collaboration.resources`。编辑位置通过稳定的 `data-localapp-edit-surface` / `data-localapp-edit-field` 暴露给 Platform Shell；不要自行实现用户身份、Awareness Server 或遮罩层。

## 文件、图片与 PDF

上传使用 SDK content API，数据库只保存受保护的 file key、文件名、MIME、大小和业务 owner。下载和预览使用 SDK 返回的 authenticated content URL。

- 校验 MIME、大小和文件名；不相信扩展名。
- 图片必须有 alt 文本和可关闭的键盘灯箱。
- PDF 使用模板固定的 `react-pdf` / `pdfjs-dist` worker，提供 loading、错误、页码和前后翻页状态。
- 文件变化或组件卸载时释放 object URL。
- 不把用户上传内容打进 `.localapp` 应用包。

允许的预览类型包括 `png/jpg/jpeg/gif/webp/svg/pdf`。应用包安装前拉取生产快照只能由显式的数据同步流程完成，不能被普通安装或运行时 reset 隐式触发。运行时 reset 只重新应用当前已安装版本的 migrations；`db/seeds/dev.sql` 仅供应用自己的离线测试工具显式使用，当前 `localapp` CLI 不提供数据库 reset 命令。

## UI 组件

优先复用 shadcn/ui 基础组件，应用内从 `@/components/ui` 引入。组合复杂交互前阅读 `.claude/skills/localapp-ui/SKILL.md`，保留键盘、焦点、loading、empty 和 error 状态。

## Device Actions

需要在“当前点击按钮的电脑”执行本机动作时，使用通用 Device Action SDK。Web 只获取短期 `localapp://` 激活票据；脚本、正文、API Key 和依赖不得进入 Scheme URL。

- 首次发布者或权限扩展必须在本机 Server 页面确认。
- 权限只声明必要的文件目录和子进程能力。
- 不添加设备选择器、远程执行通道或应用私有 daemon。

## 对等同步

```bash
localapp app sync --target local --peer office
localapp app sync --target local --peer office --with-data --confirm-app <exact-name>
```

默认只同步应用包、manifest、migration 和 backend contract。`--with-data` 才整体替换目标应用数据库和文件；目标端会先备份并在失败时回滚。用户、权限和 API Key 不自动同步。

## 完成标准

提交前至少满足：

1. `npm test` 与应用测试通过。
2. `localapp check --json` 返回 `success: true`。
3. `localapp app install --target <profile>` 成功，并由结果中的 `serverUrl`、`ownerId`、`name` 组成正式 URL。
4. 应用内 Browser 的 DOM 与 console 无未解释错误。
5. 核心创建、读取、更新、删除、上传/下载和权限路径按本应用范围通过。
6. 没有凭据、运行数据或仓库外临时路径进入应用包与提交。

import type { FastifyInstance } from "fastify";

const STARTER_DOC = `# LocalApp 快速上手（面向 AI Agent 与开发者）

本文件由 LocalApp Server 提供，当前实例：{{origin}}

LocalApp 是一个本机应用平台：AI Agent 或开发者用 React + TypeScript 编写业务应用，
平台统一托管认证、数据契约、文件、通知与运维。CLI 负责创建、校验和安装应用。

## 前置条件

- Node.js >= 24
- 安装 CLI：\`npm install -g @patodo/localapp\`（也可以在 {{origin}} 首页下载对应平台的 CLI）
- 运行 \`localapp --version\` 确认安装成功

## 第一步：获取 API Key 并连接本实例

1. 在浏览器打开 {{origin}}，登录账号（新实例首次使用请按 {{origin}}/setup 引导创建管理员）
2. 进入密钥页 {{origin}}/my/keys 创建一个 API Key
3. 在本机执行：

\`\`\`bash
localapp login {{origin}} --api-key <你的APIKey>
\`\`\`

成功后凭据保存在名为 default 的 profile；用 \`localapp whoami\` 验证身份。

## 第二步：初始化应用

\`\`\`bash
mkdir -p ~/localapp-apps && cd ~/localapp-apps
localapp init my-app
cd my-app
\`\`\`

初始化会生成一个完整的 React + TypeScript 项目，并默认安装到当前连接的 Server
（加 \`--skip-deploy\` 可只生成项目）。

## 第三步：实现应用

**如何写一个应用、如何上传，全部说明都在初始化生成的项目里**：

- \`AGENTS.md\` — 开发与验收约定（必读）
- \`.claude/skills/localapp*/SKILL.md\` — 平台能力手册：auth 登录、business 业务建模、
  data 数据库、upload 文件上传、notify 通知、ui 组件、device-actions 本机操作、
  collaboration 实时协作

在项目目录内的日常闭环：

\`\`\`bash
localapp dev                          # 本地开发调试
npm run build && localapp check       # 构建 + 契约与迁移校验
localapp app install                  # 安装/更新到当前 profile 的 Server
\`\`\`

## 第四步：验收

安装后从正式路径访问：\`{{origin}}/<owner>/<app>/\`。
应用功能必须从正式路径验收；\`/serve/<owner>/<app>/\` 仅用于资源与 API 诊断。

## CLI 速查

| 命令 | 说明 |
| --- | --- |
| \`localapp login <url> --api-key <key>\` | 保存某实例的凭据（\`--profile\` 命名） |
| \`localapp whoami\` / \`localapp logout\` | 查看 / 移除当前凭据 |
| \`localapp init [name]\` | 初始化应用项目 |
| \`localapp dev\` | 本地开发 |
| \`localapp check [--json]\` | 校验应用、契约与迁移 |
| \`localapp app install [--target <profile>]\` | 构建并安装到 Server |
| \`localapp app sync --peer <name>\` | 同步应用到 peer Server |
| \`localapp server [start\\|stop\\|status\\|logs]\` | 管理本机 daemon |
| \`localapp help [command]\` | 查看帮助 |

## 给 AI Agent 的提示

- 用户没有说明应用主题时，直接采用内置模板的默认示例开始，**不要向用户提问**。
- 只创建和修改项目目录内的文件；**不要修改、重装或调试全局 localapp CLI、Server 或系统配置**。遇到环境故障（命令不存在、Server 不可达、安装失败）时，停止重试并把错误原样报告用户。
- 临时产物放在项目自己的 \`tmp/\` 目录，不要写系统临时目录。
- 不要实现第二套后端；数据、文件、通知一律使用平台 SDK 与 named SQL。
- 修改后先 \`localapp check\` 再 \`localapp app install\`，并从正式路径验收。
`;

export function renderStarterDoc(origin: string): string {
  return STARTER_DOC.replaceAll("{{origin}}", origin);
}

export function starterDocRoutes(app: FastifyInstance): void {
  app.get("/starter.md", async (request, reply) => {
    const origin = `${request.protocol}://${request.hostname}`;
    return reply.type("text/markdown; charset=utf-8").send(renderStarterDoc(origin));
  });
}

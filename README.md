# LocalApp

LocalApp 是一个介于低代码平台与高度定制开发之间的开源 Agent 应用平台。

应用仍然是开发者可直接维护的 React / TypeScript 项目；平台统一提供认证、权限、数据契约、文件、通知、Issue、AI Shell、版本发布和数据运维能力。目标不是隐藏代码，而是让 Agent 创建的业务应用以更高的一次成功率完成开发、检查、发布和运行。

## 平台定位

LocalApp 面向表单、台账、协作流程、内部工具等中轻度复杂业务应用。应用可以自由实现界面和交互，但不需要为每个项目重复搭建账户体系、通用后端和部署设施。

| 应用保留 | 平台提供 |
| --- | --- |
| React / TypeScript 源码与业务界面 | 用户、会话、群组和访问控制 |
| 业务模型、SQL migration 和数据契约 | Named SQL 执行、事务和数据库隔离 |
| 可测试、可审查的业务规则 | 文件存储、通知、Issue 和 AI Shell |
| 应用自带 `manifest.json` | 平台配置 `manifest.platform.json` |
| 自己的 Git 历史和工程工具链 | 版本发布、验收、备份、导入导出和下线 |

LocalApp 默认采用 **Named SQL first**。稳定后端能力由 migration、声明式 query/mutation 和事务 mutation 组成；平台不要求应用开发者编写独立服务，也不把任意 Hosted JavaScript Action 作为默认生产后端。

## 应用开发流程

### 1. 安装工具

从平台公开首页或 GitHub Release 下载当前系统对应的 CLI。个人本地开发和运行
不要求先部署或登录 LocalApp Server；需要 AI、团队协作或远端发布时，再绑定
目标实例：

```bash
localapp login --server-url http://localhost:3000
```

首次安装前必须同时下载 Release 中的 `SHA256SUMS` 并校验 CLI 文件。Linux 使用
`sha256sum --ignore-missing -c SHA256SUMS`，macOS 使用
`grep "  <CLI_FILENAME>$" SHA256SUMS | shasum -a 256 -c -`（将占位符替换为
下载的文件名）；Windows 使用
`(Get-FileHash .\localapp-cli-*.exe -Algorithm SHA256).Hash`，并确认结果与
`SHA256SUMS` 中对应文件的摘要一致。摘要不一致时不要运行该文件。

CLI 会引导输入 API Key。浏览器用户使用服务端持久会话 Cookie，CLI 和程序化 API 使用 API Key。

### 2. 创建应用

```bash
localapp init --name my-app
cd my-app
```

`init` 会创建可直接开发的 React 项目，并写入 LocalApp SDK、本地开发 Shell、示例 migration、Named SQL 契约及 Agent skills。无需外部模板仓库时可使用：

```bash
localapp init --name my-app --builtin-repo
```

已有项目在 CLI 升级后可运行 `localapp sync`，更新由 CLI 管理的 runtime 和 `.claude/skills/localapp*/` 内容；`localapp eject` 可将这些内容一次性转为应用自行维护。

### 3. 开发与检查

```bash
localapp dev
localapp check
```

`localapp dev` 启动应用开发环境并接入派生的 Dev Shell。`localapp check` 在上传前检查平台兼容性、migration、backend contract、测试、构建结果和发布目录。

数据库常用命令：

```bash
localapp db reset
localapp db migrate
localapp db status
localapp db validate
localapp db types --output src/lib/database.types.ts
```

### 4. 本地安装或远端发布

个人本地正式运行：

```bash
localapp build --package
localapp local install
```

`build --package` 生成可移植的 `.localapp`，`local install` 将它安装到 Desktop
管理的本地应用库。Desktop 使用一个 MiniServer 承载多个本地应用，应用在默认
浏览器中打开，不要求运行源码目录、Vite 或远端 LocalApp Server。

需要发布给团队时，先配置目标 Server，再显式选择该配置：

```bash
localapp server add company --url https://localapp.example.com
localapp server login company
localapp upload --profile company --verify
```

`upload --profile company --verify` 会构建和上传应用，并在正式应用路径创建
隔离会话执行 smoke 验收。需要单独复验时可运行：

```bash
localapp verify --as owner
localapp verify --as member
```

## 运行模型

### 正式入口与 Platform Shell

应用的正式访问路径是：

```text
/{owner}/{app}/
```

平台在正式入口提供统一的 Platform Shell，包括应用导航、Issue、在线用户、收藏、登录态和用户操作。应用源码在本地开发时使用 Dev Shell，发布后由平台切换为正式 Shell。

```text
/serve/{owner}/{app}/
```

`/serve/` 是原始应用资源和 API 的内部基址，只用于资源/API 诊断，不是用户预览或正式访问入口。

### 数据库与 Named SQL

每个应用拥有隔离数据库。数据结构由 `migrations/*.sql` 管理，应用后端契约位于：

```text
backend/
└── resources/
    └── <resource>/
        ├── schema.json
        ├── queries.json
        └── mutations.json
```

- Query 用于参数化读取、过滤、分页和聚合。
- Mutation 用于经过权限校验的写入。
- Transaction mutation 用于需要原子提交的多步业务操作。
- 权限和参数约束写入契约，由平台在上传和运行时统一验证。

可以从 migration 生成标准 CRUD 契约：

```bash
localapp backend scaffold
localapp backend scaffold --table work_items --security-profile owner
```

旧的 `localapp schemas` 命令已废弃，不再写入平台 schema。

### 双 Manifest

应用包含两个配置来源：

- `manifest.json`：应用源码自带配置，随版本上传。
- `manifest.platform.json`：平台侧配置，由应用所有者在设置页维护。

平台配置优先。所有者可以在设置页切换到应用自带配置；切换后 manifest 相关设置只读。应用信息、基础设置、访问控制、数据权限、通知和数据管理按页签分类。

### 数据与文件运维

应用设置的数据管理页支持：

- 创建和下载完整备份。
- 导出包含应用数据库与文件数据的压缩归档。
- 在应用、版本和数据表结构兼容校验通过后导入归档。
- 恢复历史备份。
- 恢复出厂设置：保留应用及发布版本，只重置数据库和平台配置。

不兼容的应用标识、归档版本或表结构会在写入前被拒绝，避免部分导入造成数据状态不一致。

## 平台能力

- **认证与身份**：浏览器持久会话、API Key、用户资料和群组。
- **访问控制**：公开、登录用户、所有者、成员、ACL 和资源级权限。
- **数据契约**：SQL migration、Named SQL query/mutation、事务 mutation。
- **文件能力**：应用文件上传、访问控制、归档导入导出。
- **协作能力**：通知、Issue、评论、指派、在线用户和收藏。
- **Agent 能力**：初始化模板内置开发规范和 skills，Platform Shell 提供 AI 入口。
- **应用运维**：版本历史、平台配置、数据备份、下线、恢复出厂设置和删除。

## 常用 CLI

| 命令 | 说明 |
| --- | --- |
| `localapp init --name <name>` | 创建并初始化应用 |
| `localapp build --package` | 构建并生成不含本地数据的 `.localapp` |
| `localapp local install` | 将当前应用包安装或更新到 Desktop 本地应用库 |
| `localapp server add/list/use/remove` | 管理多个远端 Server 配置 |
| `localapp server login <name>` | 登录指定 Server 配置 |
| `localapp dev` | 启动带 Dev Shell 的本地开发环境 |
| `localapp check` | 执行上传前完整检查 |
| `localapp upload --profile <name> --verify` | 发布到明确指定的 Server 并执行 smoke 验收 |
| `localapp verify --as owner\|member` | 使用隔离身份复验已发布应用 |
| `localapp sync` | 更新 CLI 管理的 runtime 和 Agent skills |
| `localapp platform version` | 查看平台版本与兼容状态 |
| `localapp backend scaffold` | 从 migration 生成 Named SQL 契约 |
| `localapp db validate` | 用生产快照验证本地 migration |
| `localapp pages list` | 查看当前账号的应用 |
| `localapp groups list` | 查看用户组 |
| `localapp update` | 更新 CLI |

使用 `localapp <command> --help` 查看完整参数。

## 本地开发

要求 Node.js、pnpm 和 Rust 工具链。

```bash
pnpm install --frozen-lockfile
pnpm dev
```

开发环境：

- `http://localhost:3000`：LocalApp Server、正式应用入口和 API。
- `http://localhost:3001`：Next.js Web 开发服务，由 Server 在开发模式下配合使用。

常用构建与测试：

```bash
pnpm build
pnpm build:cli
pnpm -C packages/server test
pnpm -C packages/web test
pnpm -C init-repo test
pnpm test:platform-regression
pnpm test:e2e-ui
```

主要目录：

```text
packages/
├── cli/          # Rust CLI
├── server/       # 平台服务入口
├── server-core/  # 平台核心运行时
├── web/          # 公开首页、个人工作台和平台设置
├── sdk-core/     # SDK 核心
├── sdk-react/    # React SDK
├── sdk-agent/    # Agent/AI SDK
└── desktop/      # Windows-first Tauri 桌面伴侣
init-repo/        # 应用内置模板、示例契约和 Agent skills
openspec/specs/   # 平台行为规格
```

## Docker 部署

生产镜像包含 Server、Web 静态产物和平台运行时，对外只需要一个 HTTP 端口。CLI 与 Desktop 由 GitHub Release 独立分发，镜像不会内嵌这些发行二进制：

```bash
docker build -t localapp-server:local .
cp deploy/production/.env.example deploy/production/.env
```

修改 `.env` 中的镜像名和生产密钥后启动：

```bash
docker compose \
  --env-file deploy/production/.env \
  -f deploy/production/docker-compose.yml \
  up -d
```

默认 Compose 将宿主机 `deploy/production/data/` 挂载到容器 `/app/data`。升级镜像不会删除数据库、应用版本、文件和备份；生产迁移前仍应先制作数据目录快照。

离线传输镜像：

```bash
docker save localapp-server:local -o localapp-server.tar
docker load -i localapp-server.tar
```

## Desktop 与 Windows 发行

LocalApp Desktop 是 Windows-first 本地应用管理器和平台伴侣。它维护本地应用
库，以一个 MiniServer 承载多个已安装应用，并在默认浏览器中打开应用；个人
用户无需部署远端 LocalApp。Desktop 同时保留通知、收藏、可信本地动作和固定
JavaScript runner，并可将本地应用按需发布到明确选择的 LocalApp Server。

Windows CLI 和 Tauri/NSIS 客户端必须在 Windows x64 环境构建。完整的环境准备、签名、校验、上传和干净虚拟机验收流程见：

- [Desktop 说明](packages/desktop/README.md)
- [本地运行与按需发布](docs/local-runtime.md)
- [Windows 本地发行指南](docs/windows-local-release.md)
- [Windows 构建脚本](scripts/build-windows-release.ps1)

## 设计与规格

- [OpenSpec 平台规格](openspec/specs)
- [公开源码发布指南](docs/open-source-release.md)
- [贡献指南](CONTRIBUTING.md)
- [安全策略](SECURITY.md)
- [应用模板说明](init-repo/CLAUDE.md)

## 开源许可证

LocalApp 采用 [MIT License](LICENSE)。你可以自由使用、复制、修改和分发本项目，但需保留原始版权和许可证声明。

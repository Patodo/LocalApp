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

LocalApp 只发布一个 npm 包；该包提供唯一的 `localapp` CLI、统一 Server、用户
daemon 以及随包分发的按平台 native adapter。个人本地开发和运行不要求先部署
远端 Server；需要 AI、团队协作或远端发布时，再绑定目标实例：

```bash
npm install --global localapp
localapp server
localapp login --server-url http://localhost:3000
```

固定版本安装可使用 `npm install --global localapp@<version>`。npm registry 中的
`localapp-<version>.tgz` 是唯一用户发行物；Windows、macOS 和 Linux 的 native
adapter 是包内受摘要约束的系统集成组件，不是第二个 CLI 或另一套运行时。

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

`localapp dev` 启动应用开发环境并接入派生的 Dev Shell。`localapp check` 在应用包构建或安装前检查平台兼容性、migration、backend contract、测试、构建结果和发布目录。

数据库常用命令：

```bash
localapp db reset
localapp db migrate
localapp db status
localapp db validate
localapp db types --output src/lib/database.types.ts
```

这些命令只维护项目 `tmp/localapp-schema/schema.db` 下的离线 schema 工作库，用于
migration 校验、seed 检查和类型生成，不是应用运行时后端。运行中应用的数据重置、
快照和恢复由 Dev Toolkit 调用当前统一 Server 完成。

### 4. 安装、发布与对等同步

构建并安装到一个命名 Server：

```bash
localapp build --package
localapp app install --target local
```

`build --package` 生成可移植的 `.localapp`，`app install` 将包提交给目标 Server。
本地与远程都运行同一份 Server 包，并使用同一套应用、认证、权限、数据库和文件实现；
两者只在监听地址、数据目录和存储配置上不同。

配置目标 Server 后显式选择 profile：

```bash
localapp server add company --server-url https://localapp.example.com --api-key "$LOCALAPP_API_KEY"
localapp app install --target company
```

应用包和数据同步由源 Server 发起。对端 API Key 只保存在源 Server 的 Web 设置中：

```bash
localapp app sync --target local --peer company
localapp app sync --target local --peer company --with-data --confirm-app my-app
```

默认只同步应用包、manifest、migration 和 backend contract；显式 `--with-data`
才会整体替换目标端应用数据库与文件，并在目标端失败时回滚。需要单独复验时可运行：

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
- 权限和参数约束写入契约，由平台在应用包安装和运行时统一验证。

可以从 migration 生成标准 CRUD 契约：

```bash
localapp backend scaffold
localapp backend scaffold --table work_items --security-profile owner
```

旧的 `localapp schemas` 命令已废弃，不再写入平台 schema。

### 双 Manifest

应用包含两个配置来源：

- `manifest.json`：应用源码自带配置，打入应用包并随版本安装。
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
| `localapp app install --target <name>` | 将当前项目或显式 `.localapp` 包安装到目标 Server |
| `localapp app sync --peer <name>` | 从当前 Server 向已配置对端同步应用版本 |
| `localapp app sync --with-data --confirm-app <name>` | 在精确确认后同步应用数据库和文件 |
| `localapp server add/list/use/remove` | 管理 CLI 使用的 Server 连接 |
| `localapp login --profile <name>` | 登录并保存指定 Server 的 API Key |
| `localapp dev` | 启动带 Dev Shell 的本地开发环境 |
| `localapp check` | 执行安装前完整检查 |
| `localapp verify --as owner\|member` | 使用隔离身份复验已发布应用 |
| `localapp sync` | 更新 CLI 管理的 runtime 和 Agent skills |
| `localapp platform version` | 查看平台版本与兼容状态 |
| `localapp backend scaffold` | 从 migration 生成 Named SQL 契约 |
| `localapp db validate` | 用生产快照验证本地 migration |
| `localapp pages list` | 查看当前账号的应用 |
| `localapp groups list` | 查看用户组 |
| `localapp update` | 查询 npm 更新并输出固定版本安装命令 |

使用 `localapp <command> --help` 查看完整参数。

## 本地开发

要求 Node.js 24 和 pnpm 10。仅构建 npm 包内按平台分发的 native adapter 时需要
对应平台的 Swift 或 Rust 工具链；CLI 与 Server 本身均由 TypeScript/Node.js 构建。

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
pnpm -C packages/localapp build
pnpm -C packages/localapp build:package
pnpm -C packages/server test
pnpm -C packages/web test
pnpm -C init-repo test
pnpm test:platform-regression
pnpm test:e2e-ui
```

主要目录：

```text
packages/
├── localapp/     # 唯一 npm 包、CLI、daemon 与 native adapter
├── server/       # npm 包内部使用的平台服务入口
├── server-core/  # 平台核心运行时
├── web/          # 公开首页、个人工作台和平台设置
├── sdk-core/     # SDK 核心
├── sdk-react/    # React SDK
├── sdk-agent/    # Agent/AI SDK
init-repo/        # 应用内置模板、示例契约和 Agent skills
openspec/specs/   # 平台行为规格
```

## Docker 部署

生产镜像从同一 `localapp` npm 包启动前台 Server，对外只需要一个 HTTP 端口。
容器不注册 Scheme、不弹系统通知，也不需要桌面 native adapter：

```bash
npm run package:localapp
docker build -t localapp:local .
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
docker save localapp:local -o localapp-image.tar
docker load -i localapp-image.tar
```

## Native adapter 与 Windows 发行

LocalApp 没有托盘、Desktop 窗口或独立原生 CLI。npm 包启动同一 Node.js Server：
`localapp server` 注册并启动当前用户 daemon，`localapp server run` 在前台运行。
包内极小 native adapter 只负责注册和转发 `localapp://`、显示系统通知及回传点击；
所有安全决策、应用管理和动作执行仍由 daemon 中的 Server 完成。

Windows 的用户发行物仍是标准 npm tgz。完整的 native adapter 构建、签名、打包
检查和干净环境验收流程见：

- [本地运行与按需发布](docs/local-runtime.md)
- [Windows 本地发行指南](docs/windows-local-release.md)

## 设计与规格

- [OpenSpec 平台规格](openspec/specs)
- [公开源码发布指南](docs/open-source-release.md)
- [贡献指南](CONTRIBUTING.md)
- [安全策略](SECURITY.md)
- [应用模板说明](init-repo/CLAUDE.md)

## 开源许可证

LocalApp 采用 [MIT License](LICENSE)。你可以自由使用、复制、修改和分发本项目，但需保留原始版权和许可证声明。

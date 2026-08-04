## Why

LocalApp 当前仍要求个人用户维护 Vite 进程或部署完整 Server 才能持续运行应用，这与“本地优先、按需发布”的产品定位不一致。需要让 Desktop 直接管理一个多应用 Local Runtime，使无运维基础的个人用户安装后即可运行应用，同时保留面向企业或团队 Server 的显式发布路径。

## What Changes

- Desktop 新增本地应用库和 Local Runtime 生命周期管理，一个常驻进程承载全部已安装应用，并在默认浏览器中打开应用。
- 引入可校验的 `.localapp` 应用包；包只包含构建产物、manifest、migration、Named SQL/backend contract 与完整性元数据，不包含数据库、用户文件、平台配置、凭据或任意服务器执行代码。
- 为每个本地应用建立独立 Origin、版本目录、SQLite 数据库、文件与备份目录；应用升级原子切换版本，失败时保留旧版本和用户数据。
- 本地模式提供稳定的单用户身份和 Local Platform Shell，无需远端账号、API Key 或 LocalApp Server。
- CLI 新增本地构建打包与安装入口，使应用可以在不登录远端 Server 的情况下完成检查、构建、打包和本地运行。
- CLI 与 Desktop 支持命名 LocalApp Server 配置，并允许发布时显式选择目标；同一次检查、上传和验证必须固定使用同一个目标。
- 远程发布继续沿用现有原子上传协议，只发布应用代码产物；本地数据库和文件仅能通过独立、显式的数据迁移流程处理。
- 保留 `localapp dev` 作为源码热更新工作流；已安装应用不启动独立 Vite 或独立 Node 进程。

## Capabilities

### New Capabilities

- `local-app-package`: 定义可安装 `.localapp` 包的内容、完整性验证、兼容性校验和数据隔离边界。
- `desktop-local-runtime`: 定义 Desktop 管理的单进程多应用 Runtime、本地身份、独立 Origin、生命周期和应用管理体验。
- `server-profiles`: 定义命名 Server 配置、目标解析优先级、凭据隔离与指定目标发布行为。

### Modified Capabilities

- `native-app-runtime`: 将 Platform Shell 的同页 native app 承载契约扩展到本地应用正式入口。
- `cli-tool`: 增加无需远端登录的应用打包/本地安装命令，并为登录、检查和上传增加命名 Server 目标。
- `upload-atomic-deploy`: 要求远程发布全流程绑定单一已解析目标，并明确不隐式上传本地应用数据。

## Impact

- 新增 `packages/local-runtime`，复用 `packages/server-core` 的 Named SQL、migration、内容和应用 API 契约。
- 扩展 `packages/desktop` 的 Rust 生命周期管理、本地应用注册与安装事务、Tauri commands、应用管理 UI 和打包资源。
- 扩展 `packages/localapp-core` 的 Server profile 存储与目标解析，并调整 `packages/cli` 的构建、安装、登录、检查和上传命令。
- 调整 Platform Shell 的运行时配置，使生产 Server 与 Local Runtime 使用一致的 native app host，不依赖 `/serve/` 作为用户入口。
- 增加 Node、Rust、Desktop UI、CLI 和跨进程集成测试；Desktop 安装包体积将增加 Local Runtime bundle，但继续复用现有固定 Node sidecar。

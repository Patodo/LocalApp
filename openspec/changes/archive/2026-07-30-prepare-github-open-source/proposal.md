## Why

LocalApp 已确定采用 MIT 许可证并发布到 GitHub，但当前源码仍依赖编译进 CLI 的共享注册密钥，用户创建会返回固定临时密码，仓库历史包含大量 CLI 二进制和内部执行资料，发行链路也没有以 GitHub Release 为公开边界。现在需要建立一条不破坏现有用户与部署、可重复验证且不泄露内部信息的公开发布路径。

## What Changes

- **BREAKING** 删除 `POST /api/auth/cli-register`、共享 `.registration-key`、CLI 自动注册和 Docker 中的注册密钥复制；CLI 登录只接受管理员签发的 API Key。
- 管理员创建用户时同时生成随机临时密码和 API Key，并在管理界面中只展示一次；重置密码改为随机临时密码，不再使用固定值。
- CLI 在保存交互式或非交互式 API Key 前调用目标 Server 验证身份，失败时不覆盖已有配置。
- 建立可重复的 GitHub 公开源码导出和校验流程，排除历史二进制、归档变更、内部评审产物、内部环境信息和固定测试凭据。
- 将 CLI、Desktop、Server 镜像和校验文件迁移到 GitHub Releases / GHCR，公开源码仓库不再跟踪发行二进制。
- 增加 GitHub CI 的源码构建、测试、OpenSpec、凭据扫描和公开快照门禁，并补充贡献与安全报告文档。
- 更新公开文档、测试夹具和 OpenSpec 背景，使用可生成的测试身份与示例域名，不保留真实内部服务器信息。
- 保留当前内部 Git 仓库历史；公开 GitHub 仓库从通过门禁的清理后快照初始化，不重写当前远端历史。

## Capabilities

### New Capabilities

- `public-source-release`: 定义公开源码快照的允许内容、排除内容、确定性导出、凭据扫描和 GitHub 初始化门禁。
- `github-release-distribution`: 定义 CLI、Desktop、Server 镜像、校验文件和版本元数据通过 GitHub Releases / GHCR 分发的行为。
- `admin-user-provisioning`: 定义管理员创建用户、随机临时密码、初始 API Key 和一次性凭据展示的完整供应流程。

### Modified Capabilities

- `user-auth`: 删除客户端共享注册密钥和 CLI 自动注册端点，保留管理员供应和浏览器登录。
- `api-key-auth`: 新签发的 API Key 只返回一次并以摘要存储，列表只返回掩码，同时兼容验证升级前的现有 Key。
- `password-reset`: 将固定重置密码改为一次性随机临时密码，并要求首次登录修改。
- `admin-api`: 创建用户和重置密码接口返回一次性凭据，并禁止凭据在后续查询中再次读取。
- `admin-panel`: 创建用户和重置密码后展示一次性凭据与复制操作。
- `cli-tool`: 登录流程不再尝试自动注册，验证 API Key 后才保存配置。
- `cli-non-interactive-login`: 非交互登录必须验证 Server URL 与 API Key，失败时保持原配置。
- `server-config`: 移除共享 registration key 文件及相关运行时配置语义。
- `docker-packaging`: Docker 构建不再要求 `.registration-key` 或仓库内历史 CLI 二进制，官方镜像通过 GHCR 分发。
- `cli-update`: CLI 版本发现和更新改为消费 GitHub Release 发行元数据。
- `cli-build-codesign`: CLI 构建产物由 GitHub Release workflow 生成、签名、校验并发布。

## Impact

- Server：认证路由、管理员 API、密码重置、API Key 创建、配置加载和测试夹具。
- Web：用户管理的一次性凭据弹窗、复制与关闭行为。
- CLI：login、build.rs、构建脚本、配置覆盖保护、版本发现和更新。
- Docker/CI：Dockerfile、Compose 文档、GitHub Actions、GHCR 和 Release workflow。
- 仓库治理：公开快照脚本、排除清单、凭据扫描、`CONTRIBUTING.md`、`SECURITY.md` 和公开 README。
- 兼容性：现有账号、API Key、浏览器会话和应用数据保持有效；旧 CLI 的自动注册请求会明确失败并回退到手工 API Key。

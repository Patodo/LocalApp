## Context

LocalApp 已采用 MIT 许可证，并准备以 GitHub 作为公开源码、Release 和容器镜像的发行边界。当前仓库和运行时仍混合了三类不适合直接公开的内容：

- CLI 通过编译期共享 registration key 调用自动注册接口，任何获得公开 CLI 的人都将获得相同的用户创建能力。
- 管理员创建和重置用户时使用固定临时密码，无法满足公开部署的最小凭据安全要求。
- 源码树和 Docker 构建依赖仓库内 CLI 二进制及内部发布资料，公开仓库无法形成可审计、可重复的源码边界。

本变更跨越 Server、Web、Rust CLI、Docker、GitHub Actions 和仓库治理。实施期间必须保持已有用户、API Key、Cookie 会话、应用数据库和文件数据有效；公开 GitHub 仓库从清理后的源码快照初始化，当前内部仓库历史不做重写。

## Goals / Non-Goals

**Goals:**

- 消除公开客户端中可复用的共享注册凭据，改为管理员供应用户和 API Key。
- 让用户创建与密码重置产生不可预测、只展示一次的临时凭据。
- 让 CLI 在持久化配置前验证 Server 和 API Key，验证失败时保留已有可用配置。
- 建立可重复、可校验的公开源码快照，阻止内部资料、密钥和发行二进制进入 GitHub。
- 以 GitHub Releases 分发 CLI 和 Desktop，以 GHCR 分发 Server 镜像，并对下载产物进行摘要校验。
- 通过 CI 对源码、OpenSpec、凭据、公开快照和发行产物执行门禁。

**Non-Goals:**

- 不在本变更实现 Desktop Local Runtime、Desktop Studio、Community Hub 或嵌入式 Agent。
- 不开放浏览器自助注册、邀请注册、OAuth 注册或公开租户创建。
- 不迁移或重写当前内部 Git 仓库历史。
- 不改变应用访问路径、Named SQL、应用数据格式或现有登录 Cookie 生命周期。
- 不引入商业代码签名证书；没有平台证书时仍允许明确标记的未签名或 ad-hoc 签名开发产物。

## Decisions

### 1. 用户只能由管理员供应

`POST /api/auth/cli-register` 不再执行注册。为使旧 CLI 获得明确反馈，Server 在一个兼容周期内保留同路径的无副作用墓碑响应：返回 HTTP 410、稳定错误码 `CLI_AUTO_REGISTRATION_REMOVED`，并提示管理员创建用户和 API Key。该路由不读取 registration key，也不写入任何用户数据。

管理员创建用户时，Server 使用密码学安全随机源生成临时密码和 API Key，在同一事务中写入用户、密码哈希、`must_change_password=1` 和 API Key 哈希。成功响应只返回一次明文凭据；用户列表、详情、API Key 列表、日志和后续查询均不得返回明文。密码重置采用相同的随机临时密码策略，但不自动轮换现有 API Key。

临时密码采用至少 128 bit 熵的 URL-safe 字符串。API Key 延用现有高熵生成与哈希存储逻辑。Server 不再依赖 `ADMIN_DEFAULT_PASSWORD` 创建普通用户；bootstrap admin 的初始部署机制保持不变，避免破坏现有无人值守部署。

新签发 API Key 的数据库字段保存带算法标识的 SHA-256 摘要和末尾显示标识，API Key 列表只返回掩码。验证流程先匹配旧版明文记录，再匹配摘要记录，使现有部署中的 Key 无需迁移即可继续使用；所有新 Key 都走摘要路径。

替代方案：

- 保留共享 registration key：公开 CLI 会使共享秘密失去秘密属性，因此否决。
- 开放自助注册：与首版公开部署的管理员控制策略冲突，因此延后到独立变更。
- 将临时密码发送到邮件：当前平台没有可靠邮件通道，因此只做一次性展示。

### 2. 一次性凭据由响应生命周期约束

管理员 API 返回 `credentials: { temporaryPassword, apiKey }`。Web 在创建成功后立即打开不可通过普通页面状态恢复的一次性凭据对话框，提供分别复制和全部复制操作，并明确关闭后无法再次查看。重置密码只返回 `temporaryPassword`。

前端不得把凭据写入 URL、localStorage、sessionStorage、缓存查询或遥测；关闭对话框即丢弃内存状态。若管理员未复制即关闭，只能再次重置密码或新建 API Key。

替代方案：

- 数据库存储可解密凭据：增加长期泄露面，因此否决。
- 仅在 toast 中显示：容易遗漏且不利于准确复制，因此否决。

### 3. CLI 登录先验证再原子保存

交互式和非交互式 `login` 都只接收 Server URL 与 API Key。CLI 对 URL 规范化后调用目标 Server 的 `GET /api/me`，携带 `X-API-Key` 和当前 `X-CLI-Version`；只有收到已认证用户对象才写入配置。

配置写入采用同目录临时文件、刷新后 rename 的原子替换方式。验证失败、网络错误、响应格式错误或写入失败时，原配置保持字节级不变。错误输出区分无效凭据、连接失败和协议不兼容，并提示从管理员获取 API Key。

CLI 删除 registration key 的编译期注入和自动注册分支。`build.rs` 只保留模板及其他真正的构建输入。

替代方案：

- 先保存再验证：失败会覆盖用户现有环境，因此否决。
- 继续允许用户名自动注册作为 fallback：重新引入共享信任边界，因此否决。

### 4. Server 通过发行清单对接 GitHub Releases

GitHub Release 是 CLI 和 Desktop 二进制的唯一公开真源。每个 Release 包含版本化产物、`SHA256SUMS` 和机器可读 `release-manifest.json`。清单至少包含版本、最低兼容 CLI 版本、目标平台、文件名、下载 URL、字节大小和 SHA-256。

Server 使用 `LOCALAPP_RELEASE_MANIFEST_URL` 获取清单，执行超时、大小限制、JSON schema 校验和短期内存缓存；获取失败时可使用最后一次成功缓存，但不得伪造版本。`GET /api/cli/version` 继续作为鉴权后的兼容入口，返回归一化清单。`GET /api/cli/download` 校验目标平台后返回到清单中精确资产 URL 的临时重定向，不拼接用户可控 URL。

CLI `update` 继续从已配置 Server 获取版本信息，因此企业部署仍可控制最低版本和可见发行；下载时允许跟随 HTTPS 重定向，并在替换自身前验证长度和 SHA-256。摘要不匹配时删除临时文件并保持当前可执行文件不变。

开发环境可通过显式 fixture 清单测试更新流程。生产镜像不包含 CLI 二进制，仅包含读取远端清单所需逻辑和可选的非敏感 fallback 元数据。

替代方案：

- Docker 镜像内携带所有平台二进制：放大镜像且让 Server 镜像与客户端发行强耦合，因此否决。
- CLI 直接固定 GitHub 仓库：绕过企业 Server 的版本治理，也要求在客户端硬编码仓库，因此否决。
- Server 代理完整二进制：增加带宽、超时和存储压力，因此使用经过校验的重定向。

### 5. GitHub Actions 负责跨平台发行

版本 tag 触发发行 workflow：

1. 在 Linux、macOS、Windows runner 构建并测试 CLI。
2. 在 Windows runner 构建 Tauri Desktop 安装包。
3. 对产物执行平台可用的签名或 ad-hoc 签名检查，生成 SHA-256 和 release manifest。
4. 发布 GitHub Release。
5. 构建不含客户端二进制的 Server 镜像，使用不可变 commit SHA 和版本 tag 推送 GHCR。

普通 pull request workflow 执行格式检查、类型检查、单元/集成测试、Rust 测试、OpenSpec 严格校验、凭据扫描和公开快照校验。Release job 只从通过同一 commit 门禁的源码生成资产。

替代方案：

- 在 Linux Docker 中构建 Windows Tauri：工具链和 WebView2/NSIS 边界不可靠，因此使用 GitHub 托管 Windows runner。
- 手工上传发行文件：不可重复且容易遗漏校验信息，因此否决。

### 6. 公开源码使用允许清单导出

新增公开快照配置和脚本，以当前已提交 commit 为输入，使用 Git 索引而不是工作区临时文件生成源码树。导出规则采用“允许的顶层路径 + 明确排除项”，至少排除：

- `openspec/changes/archive` 和 `.superpowers/sdd`
- 内部部署记录、会话交接资料、临时诊断文件和本机路径
- `.env`、密钥、证书、数据库、备份、用户上传文件
- ELF、Mach-O、PE、安装包、压缩发行物和仓库内 CLI/Desktop 二进制

脚本对输出执行路径规则、文件类型、大小、已知凭据模式和内部域名模式检查，生成内容清单与 SHA-256。相同 commit 和工具版本必须得到相同文件集合及内容摘要。公开仓库首次创建时，从通过检查的快照初始化新的 Git 历史；内部仓库只保留快照生成记录，不覆盖现有远端。

测试账号、API Key 和域名改为测试运行时生成或使用 `example.com` 占位。公开仓库保留当前 README、MIT LICENSE、当前 OpenSpec 主规格、开发/部署指南，并增加 `CONTRIBUTING.md`、`SECURITY.md` 和行为准则。

替代方案：

- 直接推送当前分支和完整历史：无法可靠清除历史二进制与内部资料，因此否决。
- 依赖 `.gitignore`：它不能约束已经被 Git 跟踪的内容，因此使用独立导出门禁。

### 7. 配置和日志不再存在 registration key 语义

删除 `.registration-key`、`AUTO_REGISTER_PATTERN`、`auth.auto_register_pattern` 和相关 postinstall/setup 脚本。配置解析遇到旧字段时忽略并输出一次弃用警告，不因旧配置拒绝启动。日志不得打印临时密码、API Key、Authorization、Cookie 或发行下载签名参数。

`ADMIN_DEFAULT_PASSWORD` 暂时只服务 bootstrap admin 兼容路径，不能用于普通用户创建或重置。后续若移除 bootstrap 密码，将由独立变更处理。

## Risks / Trade-offs

- [旧 CLI 无法自动创建账号] → 410 响应提供明确迁移说明；管理员 UI 同时生成 API Key，降低人工步骤。
- [一次性凭据被管理员关闭后丢失] → UI 明确提示且提供复制操作；密码可再次重置，API Key 可重新签发。
- [GitHub Releases 暂时不可达] → Server 使用有 TTL 的最后成功清单；CLI 更新失败时不影响当前 CLI 与平台业务。
- [下载重定向暴露 GitHub 可用性依赖] → 企业可配置镜像后的 release manifest 和资产 URL，但必须满足相同 schema 与摘要校验。
- [公开快照误排除必要源码] → CI 从快照重新执行构建和核心测试，而不是只检查文件名。
- [公开快照漏出未知敏感信息] → 允许清单、二进制识别、凭据扫描和人工首次发布审查叠加；不宣称自动扫描能替代人工审查。
- [跨平台签名能力不一致] → manifest 明确记录签名状态；正式证书作为部署秘密配置，缺失时不伪造签名成功。
- [内部和公开仓库出现版本分叉] → 每个公开快照记录内部源 commit，公开发布只接受由该快照 CI 产生的 tag。

## Migration Plan

1. 先合入配置清理、410 墓碑接口、随机凭据和 CLI 验证登录；运行认证及管理员回归测试。
2. 发布一个过渡 Server 版本。已有用户、API Key、Cookie 和应用数据不迁移；旧 CLI 自动注册收到明确 410。
3. 发布新版 CLI，移除 registration key 和自动注册逻辑。管理员为新用户创建账号并交付一次性凭据。
4. 接入 release manifest、下载摘要校验和 GitHub Actions；用预发布 tag 验证 Linux、macOS、Windows CLI、Windows Desktop 与 GHCR 镜像。
5. 删除源码树中的历史发行二进制和 registration key 文件，更新 Docker 与部署文档。
6. 生成公开源码快照，在隔离目录重新执行构建、测试、OpenSpec 和凭据扫描。
7. 从快照初始化 GitHub 仓库并发布首个公开版本；当前内部仓库及其历史保持不变。

回滚时可以回退 Server/Web/CLI 代码和 GHCR tag，但不得恢复共享 registration key 或固定临时密码。若 GitHub 发行链路故障，保留当前稳定 CLI 和 Server 镜像，暂停新版本发布即可。

## Open Questions

无。本变更不绑定尚未创建的 GitHub owner/repository 字符串；正式部署通过 `LOCALAPP_RELEASE_MANIFEST_URL` 配置发行清单地址，仓库创建后再在部署配置中填写。

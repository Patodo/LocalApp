## 1. 认证与管理员供应 RED

- [x] 1.1 [RED] 为旧 CLI 注册接口的 410 无副作用响应编写 Server 失败测试
- [x] 1.2 [RED] 为管理员原子创建用户、随机临时密码、初始 API Key 和事务回滚编写失败测试
- [x] 1.3 [RED] 为随机密码重置、不轮换 API Key 和一次性响应编写失败测试
- [x] 1.4 [RED] 为用户列表、详情和日志不泄露明文凭据编写失败测试
- [x] 1.5 提交认证与管理员供应 RED 测试

## 2. 认证与管理员供应 GREEN

- [x] 2.1 [GREEN] 将 `POST /api/auth/cli-register` 改为稳定错误码的 HTTP 410 墓碑路由
- [x] 2.2 [GREEN] 实现共享的密码学安全临时密码生成器和凭据日志脱敏
- [x] 2.3 [GREEN] 在管理员创建用户事务中生成并存储密码与 API Key 哈希，返回一次性凭据
- [x] 2.4 [GREEN] 将管理员密码重置改为随机临时密码并保持现有 API Key
- [x] 2.5 [GREEN] 更新管理员 API 类型、错误契约和测试夹具
- [x] 2.6 提交认证与管理员供应 GREEN 实现

## 3. 管理界面 RED

- [x] 3.1 [RED] 为创建用户后的一次性凭据对话框和复制操作编写组件失败测试
- [x] 3.2 [RED] 为重置密码后只显示随机临时密码编写组件失败测试
- [x] 3.3 [RED] 为关闭后不可恢复及不写入浏览器持久状态编写失败测试
- [x] 3.4 提交管理界面 RED 测试

## 4. 管理界面 GREEN 与 REFACTOR

- [x] 4.1 [GREEN] 实现创建用户一次性凭据对话框、复制单项和复制全部
- [x] 4.2 [GREEN] 实现重置密码一次性凭据展示并移除固定默认密码文案
- [x] 4.3 [GREEN] 确保关闭对话框时清除内存凭据且不写入 URL、storage 或查询缓存
- [x] 4.4 [REFACTOR] 抽取创建与重置共用的一次性凭据展示组件并完成可访问性检查
- [x] 4.5 提交管理界面 GREEN/REFACTOR 实现

## 5. CLI 安全登录 RED

- [x] 5.1 [RED] 为交互式登录验证成功后才保存配置编写 Rust 失败测试
- [x] 5.2 [RED] 为无效 API Key、连接失败和协议错误保留旧配置编写失败测试
- [x] 5.3 [RED] 为非交互式完整参数验证和不完整参数回退交互编写失败测试
- [x] 5.4 [RED] 为配置同目录临时文件与原子替换编写失败测试
- [x] 5.5 [RED] 为 CLI 构建不再依赖 registration key 编写构建失败测试
- [x] 5.6 提交 CLI 安全登录 RED 测试

## 6. CLI 安全登录 GREEN 与 REFACTOR

- [x] 6.1 [GREEN] 删除 CLI 自动注册分支、registration key 常量和构建脚本输入
- [x] 6.2 [GREEN] 实现通过 `GET /api/me` 验证候选 Server URL 与 API Key
- [x] 6.3 [GREEN] 实现配置原子写入和失败时旧配置保护
- [x] 6.4 [GREEN] 更新交互式、非交互式登录输出和中文帮助文本
- [x] 6.5 [REFACTOR] 统一登录验证错误分类与 JSON 输出
- [x] 6.6 提交 CLI 安全登录 GREEN/REFACTOR 实现

## 7. Server 配置清理 RED/GREEN

- [x] 7.1 [RED] 为忽略旧 registration key 和 auto register 配置且只警告一次编写失败测试
- [x] 7.2 [RED] 为 release manifest URL 的环境变量优先级编写失败测试
- [x] 7.3 [GREEN] 删除共享 `.registration-key`、setup/postinstall 生成逻辑和 Server 读取逻辑
- [x] 7.4 [GREEN] 删除 `AUTO_REGISTER_PATTERN` 与 config.toml 有效字段，增加无敏感值的弃用警告
- [x] 7.5 [GREEN] 增加 `LOCALAPP_RELEASE_MANIFEST_URL` / `cli.release_manifest_url` 配置解析
- [x] 7.6 [REFACTOR] 清理测试、示例配置和文档中的固定注册凭据
- [x] 7.7 提交 Server 配置清理 RED/GREEN/REFACTOR

## 8. GitHub Release 更新链路 RED

- [x] 8.1 [RED] 为发行清单 HTTPS、大小限制、schema 校验与最后成功缓存编写失败测试
- [x] 8.2 [RED] 为 CLI 版本查询归一化和资产下载精确匹配编写失败测试
- [x] 8.3 [RED] 为不安全资产 URL、未知平台和无可用清单错误编写失败测试
- [x] 8.4 [RED] 为 CLI update 的大小与 SHA-256 校验、失败不替换编写 Rust 失败测试
- [x] 8.5 提交 GitHub Release 更新链路 RED 测试

## 9. GitHub Release 更新链路 GREEN 与 REFACTOR

- [x] 9.1 [GREEN] 实现受限发行清单客户端、schema 校验、TTL 与最后成功缓存
- [x] 9.2 [GREEN] 将 `/api/cli/version` 改为返回经校验的归一化发行元数据
- [x] 9.3 [GREEN] 将 `/api/cli/download` 改为到精确 HTTPS 资产 URL 的临时重定向
- [x] 9.4 [GREEN] 在 CLI update 中跟随安全重定向并校验长度与 SHA-256 后替换
- [x] 9.5 [REFACTOR] 抽取 Server/CLI 共用的目标平台命名和测试 fixture
- [x] 9.6 提交 GitHub Release 更新链路 GREEN/REFACTOR 实现

## 10. Docker 与 GitHub Actions

- [x] 10.1 更新 Dockerfile，使公开源码可直接构建且不复制 registration key 或 CLI/Desktop 二进制
- [x] 10.2 增加 PR workflow，执行 TypeScript/Rust 检查、核心测试、OpenSpec 严格校验和凭据扫描
- [x] 10.3 增加 tag release matrix，分别构建 Linux、macOS、Windows CLI 和 Windows Desktop
- [x] 10.4 生成并校验 `SHA256SUMS` 与 `release-manifest.json`，记录真实签名状态
- [x] 10.5 构建并以版本 tag 与 commit SHA tag 推送 Server 镜像到 GHCR
- [x] 10.6 增加 workflow fixture 或 dry-run，验证 Release 资产与 manifest 一一对应
- [x] 10.7 提交 Docker 与 GitHub Actions 发行链路

## 11. 公开源码快照与文档

- [x] 11.1 定义公开顶层允许清单和内部资料、归档、运行数据、二进制排除规则
- [x] 11.2 实现从指定 Git commit 确定性导出源码快照、文件清单和内容摘要
- [x] 11.3 实现路径、二进制、大小、凭据、内部域名和本机路径门禁
- [x] 11.4 在导出快照中重新执行构建、核心测试与 OpenSpec 严格校验
- [x] 11.5 将测试身份改为运行时生成，将内部域名和真实路径改为示例值
- [x] 11.6 更新 README，并新增 `CONTRIBUTING.md`、`SECURITY.md` 与行为准则
- [x] 11.7 编写从清理快照初始化 GitHub 新历史的操作指南，明确不得重写内部历史
- [x] 11.8 提交公开源码快照与文档

## 12. E2E 场景映射与集成验证

| Spec Scenario | E2E Test | Status |
|---|---|---|
| `user-auth > Scenario: 旧 CLI 请求自动注册` | `packages/server/tests/integration/cli-register.test.ts` | ✓ |
| `admin-user-provisioning > Scenario: 成功供应用户` | `packages/server/tests/integration/admin-create-user.test.ts` | ✓ |
| `admin-user-provisioning > Scenario: 关闭一次性凭据对话框` | `packages/web/tests/admin-users.test.tsx` | ✓ |
| `admin-panel > Scenario: 用户管理页支持创建用户` | `packages/server/tests/e2e-ui/admin.test.ts` | ✓ |
| `admin-panel > Scenario: 用户管理页支持重置随机临时密码` | `packages/server/tests/e2e-ui/admin.test.ts` | ✓ |
| `cli-tool > Scenario: 首次交互式登录成功` | `packages/cli/tests/login.rs::no_arguments_complete_an_interactive_login_before_saving` | ✓ |
| `cli-tool > Scenario: API Key 无效` | `packages/cli/tests/login.rs::invalid_api_key_preserves_existing_config` | ✓ |
| `cli-tool > Scenario: Server 无法连接` | `packages/cli/tests/login.rs::connection_failure_preserves_existing_config` | ✓ |
| `cli-non-interactive-login > Scenario: 通过命令行参数登录` | `packages/cli/tests/login.rs::complete_arguments_validate_identity_before_saving` | ✓ |
| `cli-non-interactive-login > Scenario: 非交互式凭据无效` | `packages/cli/tests/login.rs::invalid_api_key_preserves_existing_config` | ✓ |
| `cli-update > Scenario: 成功更新` | `packages/cli/tests/update.rs::command_downloads_verifies_and_replaces_the_invoked_binary` | ✓ |
| `cli-update > Scenario: 摘要校验失败` | `packages/localapp-core/tests/release_integrity.rs::sha256_mismatch_does_not_replace_existing_target` | ✓ |
| `cli-update > Scenario: 容器内查询 CLI 版本` | `scripts/docker-release-smoke.sh` | ✓ |
| `cli-update > Scenario: 容器内下载 CLI 二进制` | `scripts/docker-release-smoke.sh` | ✓ |
| `public-source-release > Scenario: 从干净 commit 导出` | `scripts/export-public-source.mjs --verify` | ✓ |
| `public-source-release > Scenario: 检测到凭据` | `scripts/export-public-source.node-test.mjs` | ✓ |
| `github-release-distribution > Scenario: 发布正式版本` | `scripts/generate-release-manifest.node-test.mjs` + `.github/workflows/release.yml` | ✓ |

- [x] 12.1 [GREEN] 为 `user-auth > Scenario: 旧 CLI 请求自动注册` 编写 e2e 测试
- [x] 12.2 [GREEN] 为 `admin-user-provisioning > Scenario: 成功供应用户` 编写 e2e 测试
- [x] 12.3 [GREEN] 为 `admin-user-provisioning > Scenario: 关闭一次性凭据对话框` 编写 e2e 测试
- [x] 12.4 [GREEN] 为 `admin-panel > Scenario: 用户管理页支持创建用户` 编写 e2e 测试
- [x] 12.5 [GREEN] 为 `admin-panel > Scenario: 用户管理页支持重置随机临时密码` 编写 e2e 测试
- [x] 12.6 [GREEN] 为 `cli-tool > Scenario: 首次交互式登录成功` 编写 e2e 测试
- [x] 12.7 [GREEN] 为 `cli-tool > Scenario: API Key 无效` 编写 e2e 测试
- [x] 12.8 [GREEN] 为 `cli-tool > Scenario: Server 无法连接` 编写 e2e 测试
- [x] 12.9 [GREEN] 为 `cli-non-interactive-login > Scenario: 通过命令行参数登录` 编写 e2e 测试
- [x] 12.10 [GREEN] 为 `cli-non-interactive-login > Scenario: 非交互式凭据无效` 编写 e2e 测试
- [x] 12.11 [GREEN] 为 `cli-update > Scenario: 成功更新` 编写 e2e 测试
- [x] 12.12 [GREEN] 为 `cli-update > Scenario: 摘要校验失败` 编写 e2e 测试
- [x] 12.13 [GREEN] 为 `cli-update > Scenario: 容器内查询 CLI 版本` 编写 e2e 测试
- [x] 12.14 [GREEN] 为 `cli-update > Scenario: 容器内下载 CLI 二进制` 编写 e2e 测试
- [x] 12.15 [GREEN] 为 `public-source-release > Scenario: 从干净 commit 导出` 编写 e2e 测试
- [x] 12.16 [GREEN] 为 `public-source-release > Scenario: 检测到凭据` 编写 e2e 测试
- [x] 12.17 [GREEN] 为 `github-release-distribution > Scenario: 发布正式版本` 编写 workflow dry-run e2e 测试
- [x] 12.18 执行 Server、Web、CLI、Docker、公开快照和 release workflow 集成验证
- [x] 12.19 将所有通过的 Scenario 映射状态更新为 ✓
- [x] 12.20 提交 E2E 与集成验证

## 13. 合入审查修复

- [x] 13.1 [RED/GREEN] 覆盖 CLI 跨域资产下载并证明实例 API Key 不会离开平台 origin
- [x] 13.2 [RED/GREEN] 支持 GitHub Release HTTPS CDN 跳转并为 manifest 请求增加硬超时
- [x] 13.3 [RED/GREEN] 统一生产 CLI 发行路由与测试使用的鉴权装配
- [x] 13.4 [RED/GREEN] 让 tag 发行依赖同 commit 的公开快照与 OpenSpec 门禁
- [x] 13.5 [RED/GREEN] 拒绝嵌套环境文件与未加引号的凭据赋值
- [x] 13.6 [RED/GREEN] 保留受保护管理员的安全密码重置入口
- [x] 13.7 执行审查修复后的全量回归并提交

## 14. 第二轮合入审查修复

- [x] 14.1 [RED/GREEN] 禁止通用 CLI Client 携带 API Key 跟随任何重定向
- [x] 14.2 [RED/GREEN] 为每个发行 runner 执行 CLI 测试和产物 `--version` smoke
- [x] 14.3 [RED/GREEN] 正式镜像先加载、扫描和烟测，通过后才允许推送
- [x] 14.4 [RED/GREEN] 检测带尾随注释的未加引号 dotenv 凭据
- [x] 14.5 [RED/GREEN] 用真实 CLI 子进程验证下载、摘要校验和自替换升级
- [x] 14.6 [RED/GREEN] 使用 SemVer 比较正式版和预发布版本
- [x] 14.7 执行第二轮修复后的全量回归并提交

## 15. 第三轮合入审查修复

- [x] 15.1 [RED/GREEN] 在干净 Release runner 显式安装固定版本 OpenSpec CLI
- [x] 15.2 [RED/GREEN] 检测 JSON 与 YAML 中的非示例凭据
- [x] 15.3 [RED/GREEN] 使用完整 SemVer 规则校验发行清单版本
- [x] 15.4 在首次安装说明中要求校验 `SHA256SUMS`
- [x] 15.5 将全部增量规格同步至公开快照包含的主规格
- [x] 15.6 执行第三轮修复后的全量回归并提交

## 16. 最终公开边界审查修复

- [x] 16.1 [RED/GREEN] 检测 JSON 与 YAML 中带前后缀的复合凭据键名
- [x] 16.2 [RED/GREEN] 拒绝常见压缩包、安装包扩展名及伪装文件 magic
- [x] 16.3 清理相邻主规格中的旧公开注册成功语义并补充对应 delta specs
- [x] 16.4 修正 macOS 单资产 `SHA256SUMS` 校验命令
- [x] 16.5 执行最终修复后的全量回归并提交

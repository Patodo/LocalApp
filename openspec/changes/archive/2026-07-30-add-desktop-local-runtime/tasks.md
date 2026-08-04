## 1. 应用包与发布目标基础

- [x] 1.1 [RED] 编写 `.localapp` 清单、确定性归档、越界路径和敏感数据排除的失败测试
- [x] 1.2 [RED] 编写 Server profile 兼容加载、CRUD、原子写入、目标优先级和冲突检测的失败测试
- [x] 1.3 [GREEN] 实现共享应用包模型、校验器和 Rust 归档读写
- [x] 1.4 [GREEN] 实现 `servers.json` profile store、旧 `config.json` 兼容镜像和 `ResolvedTarget`
- [x] 1.5 [REFACTOR] 统一 URL、路径、checksum 与原子文件操作并执行聚焦测试

## 2. CLI 本地构建与指定目标发布

- [x] 2.1 [RED] 编写 `build --package`、`local install`、`server` 命令组和 `--profile` 发布的失败测试
- [x] 2.2 [RED] 编写同一次 check、注册、上传和 verify 固定使用单一目标的失败测试
- [x] 2.3 [GREEN] 实现无需远端凭据的 `localapp build --package`
- [x] 2.4 [GREEN] 实现 `localapp server add/list/use/remove` 与 `login --profile`
- [x] 2.5 [GREEN] 将 `ResolvedTarget` 贯穿 check、db validate、upload 和 verify，并避免构建失败前注册空页面
- [x] 2.6 [GREEN] 实现 Desktop 控制通道上的 `localapp local install`
- [x] 2.7 [REFACTOR] 收敛 CLI 发布上下文、JSON 输出与错误分类并执行 CLI 聚焦测试

## 3. 多应用 Local Runtime

- [x] 3.1 [RED] 编写多 Host 静态资源、Named SQL、文件、会话和数据隔离的失败测试
- [x] 3.2 [RED] 编写非法 Host/Origin、ticket 重放、控制令牌、请求预算和路径穿越的失败测试
- [x] 3.3 [RED] 编写单应用 migration/维护失败不影响其他应用及 100 个不活跃应用延迟加载的失败测试
- [x] 3.4 [GREEN] 新建 `packages/local-runtime`，实现 loopback 监听、注册表加载、Host 路由和控制协议
- [x] 3.5 [GREEN] 复用 `server-core` 实现每应用 Named SQL、migration、文件与显式数据库上下文
- [x] 3.6 [GREEN] 实现一次性 ticket、本地会话、稳定本地身份与写请求 Origin 校验
- [x] 3.7 [GREEN] 实现 Local Platform Shell、native app loader、静态资源和 SPA fallback
- [x] 3.8 [GREEN] 实现逐应用延迟初始化、错误隔离、目标连接驱逐和资源预算
- [x] 3.9 [REFACTOR] 提取生产 Server/Local Runtime 共享 factory 与契约测试，保持 `localapp dev` 回归通过

## 4. Desktop 安装、生命周期与应用库

- [x] 4.1 [RED] 编写 Desktop 路径、注册表、原子安装、升级回退、卸载保留数据和永久删除的失败测试
- [x] 4.2 [RED] 编写 Runtime start/ready/crash/restart/stop、托盘与进程树生命周期的失败测试
- [x] 4.3 [RED] 编写 Desktop 本地应用库无账号使用、安装、打开、升级、卸载和状态展示的失败测试
- [x] 4.4 [GREEN] 实现 Rust 本地应用 repository、staging 安装、migration 预检、备份和原子版本切换
- [x] 4.5 [GREEN] 实现 Local Runtime Controller、固定 Node sidecar、健康检查、限速重启和优雅停止
- [x] 4.6 [GREEN] 实现安装、列出、打开、升级、卸载和 Runtime 状态 Tauri commands/events
- [x] 4.7 [GREEN] 实现 Desktop 本地应用库 UI、系统文件选择、默认浏览器打开和无账号状态
- [x] 4.8 [GREEN] 将 Local Runtime bundle 与 Shell 静态资源加入 Desktop 打包和资源完整性检查
- [x] 4.9 [REFACTOR] 拆分 Rust `lib.rs` 与前端 gateway/types，统一错误和可访问状态展示

## 5. Desktop 指定 Server 发布

- [x] 5.1 [RED] 编写 Desktop profile 列表不泄露密钥、目标选择和发布状态的失败测试
- [x] 5.2 [GREEN] 实现 Desktop profile 管理与选定 Server 发布命令，凭据只保留在 Rust 层
- [x] 5.3 [GREEN] 在本地应用库增加发布入口，并明确本地数据不参与常规发布
- [x] 5.4 [REFACTOR] 统一 CLI 与 Desktop 的目标解析和发布结果模型

## 6. 文档与跨平台打包

- [x] 6.1 更新 README、Desktop 指南和应用开发指南，说明本地运行、源码开发和远程发布的差异
- [x] 6.2 更新 init-repo Agent skills，使应用开发者默认先构建并安装本地包、按需选择 Server 发布
- [x] 6.3 更新 Windows CI 与 VM 验收脚本，验证无系统 Node 环境中的 Local Runtime 和两个本地应用

## 7. E2E 测试与恢复集成验证

| Spec Scenario | E2E Test | Status |
|---|---|---|
| local-app-package > Scenario: 无远端账号构建应用包 | `packages/cli/tests/e2e_local_runtime.rs` | ✓ |
| local-app-package > Scenario: 包中不包含本地数据 | `packages/cli/tests/e2e_local_runtime.rs` | ✓ |
| local-app-package > Scenario: 拒绝损坏或越界的包 | `packages/desktop/src-tauri/tests/local_runtime_e2e.rs` | ✓ |
| local-app-package > Scenario: 成功安装有效包 | `packages/desktop/src-tauri/tests/local_runtime_e2e.rs` | ✓ |
| local-app-package > Scenario: 升级失败自动回退 | `packages/desktop/src-tauri/tests/local_runtime_e2e.rs` | ✓ |
| local-app-package > Scenario: 升级中断后恢复 | `packages/desktop/src-tauri/tests/local_apps.rs`, `packages/desktop/src-tauri/tests/desktop_control.rs` | ✓（状态恢复与故障注入集成，非独立进程终止 E2E） |
| local-app-package > Scenario: 卸载保留用户数据 | `packages/desktop/src-tauri/tests/local_runtime_e2e.rs` | ✓ |
| desktop-local-runtime > Scenario: 多个应用共享一个 Runtime | `packages/desktop/src-tauri/tests/local_runtime_e2e.rs` | ✓ |
| desktop-local-runtime > Scenario: Desktop 重启恢复应用库 | `packages/desktop/src-tauri/tests/local_runtime_e2e.rs` | ✓ |
| desktop-local-runtime > Scenario: 应用数据和文件不串用 | `packages/local-runtime/tests/multi-app.e2e.test.ts` | ✓ |
| desktop-local-runtime > Scenario: 非法 Host 被拒绝 | `packages/local-runtime/tests/security.e2e.test.ts` | ✓ |
| desktop-local-runtime > Scenario: 打开本地应用 | `packages/desktop/src-tauri/tests/local_runtime_e2e.rs` | ✓ |
| desktop-local-runtime > Scenario: 拒绝重放或跨应用会话 | `packages/local-runtime/tests/security.e2e.test.ts` | ✓ |
| desktop-local-runtime > Scenario: 单应用故障不阻断其他应用 | `packages/local-runtime/tests/shell.e2e.test.ts` | ✓ |
| desktop-local-runtime > Scenario: 退出与托盘行为 | `packages/desktop/src-tauri/tests/local_runtime_e2e.rs` | ✓ |
| desktop-local-runtime > Scenario: 无账号首次使用 | `packages/desktop/src/app.e2e.test.tsx` | ✓ |
| server-profiles > Scenario: 管理多个 Server | `packages/cli/tests/e2e_server_profiles.rs` | ✓ |
| server-profiles > Scenario: 旧配置继续工作 | `packages/cli/tests/e2e_server_profiles.rs` | ✓ |
| server-profiles > Scenario: 显式选择发布目标 | `packages/cli/tests/e2e_server_profiles.rs` | ✓ |
| server-profiles > Scenario: 冲突目标被拒绝 | `packages/cli/tests/e2e_server_profiles.rs` | ✓ |
| server-profiles > Scenario: 命名登录失败不破坏配置 | `packages/cli/tests/e2e_server_profiles.rs` | ✓ |
| server-profiles > Scenario: 切换当前 Server | `packages/cli/tests/e2e_server_profiles.rs` | ✓ |
| native-app-runtime > Scenario: 本地正式入口包含 Shell | `packages/local-runtime/tests/shell.e2e.test.ts` | ✓ |
| cli-tool > Scenario: 离线构建应用包 | `packages/cli/tests/e2e_local_runtime.rs` | ✓ |
| cli-tool > Scenario: 安装并打开本地应用 | `packages/cli/tests/e2e_local_runtime.rs` | ✓ |
| cli-tool > Scenario: 指定 profile 上传 | `packages/cli/tests/e2e_server_profiles.rs` | ✓ |
| upload-atomic-deploy > Scenario: 发布到指定 Server | `packages/cli/tests/e2e_server_profiles.rs` | ✓ |
| upload-atomic-deploy > Scenario: 本地数据不随发布上传 | `packages/cli/tests/e2e_server_profiles.rs` | ✓ |

- [x] 7.1 [GREEN] 为 local-app-package > Scenario: 无远端账号构建应用包 编写 e2e 测试
- [x] 7.2 [GREEN] 为 local-app-package > Scenario: 包中不包含本地数据 编写 e2e 测试
- [x] 7.3 [GREEN] 为 local-app-package > Scenario: 拒绝损坏或越界的包 编写 e2e 测试
- [x] 7.4 [GREEN] 为 local-app-package > Scenario: 成功安装有效包 编写 e2e 测试
- [x] 7.5 [GREEN] 为 local-app-package > Scenario: 升级失败自动回退 编写 e2e 测试
- [x] 7.6 [GREEN] 为 local-app-package > Scenario: 卸载保留用户数据 编写 e2e 测试
- [x] 7.7 [GREEN] 为 desktop-local-runtime > Scenario: 多个应用共享一个 Runtime 编写 e2e 测试
- [x] 7.8 [GREEN] 为 desktop-local-runtime > Scenario: Desktop 重启恢复应用库 编写 e2e 测试
- [x] 7.9 [GREEN] 为 desktop-local-runtime > Scenario: 应用数据和文件不串用 编写 e2e 测试
- [x] 7.10 [GREEN] 为 desktop-local-runtime > Scenario: 非法 Host 被拒绝 编写 e2e 测试
- [x] 7.11 [GREEN] 为 desktop-local-runtime > Scenario: 打开本地应用 编写 e2e 测试
- [x] 7.12 [GREEN] 为 desktop-local-runtime > Scenario: 拒绝重放或跨应用会话 编写 e2e 测试
- [x] 7.13 [GREEN] 为 desktop-local-runtime > Scenario: 单应用故障不阻断其他应用 编写 e2e 测试
- [x] 7.14 [GREEN] 为 desktop-local-runtime > Scenario: 退出与托盘行为 编写 e2e 测试
- [x] 7.15 [GREEN] 为 desktop-local-runtime > Scenario: 无账号首次使用 编写 e2e 测试
- [x] 7.16 [GREEN] 为 server-profiles > Scenario: 管理多个 Server 编写 e2e 测试
- [x] 7.17 [GREEN] 为 server-profiles > Scenario: 旧配置继续工作 编写 e2e 测试
- [x] 7.18 [GREEN] 为 server-profiles > Scenario: 显式选择发布目标 编写 e2e 测试
- [x] 7.19 [GREEN] 为 server-profiles > Scenario: 冲突目标被拒绝 编写 e2e 测试
- [x] 7.20 [GREEN] 为 server-profiles > Scenario: 命名登录失败不破坏配置 编写 e2e 测试
- [x] 7.21 [GREEN] 为 server-profiles > Scenario: 切换当前 Server 编写 e2e 测试
- [x] 7.22 [GREEN] 为 native-app-runtime > Scenario: 本地正式入口包含 Shell 编写 e2e 测试
- [x] 7.23 [GREEN] 为 cli-tool > Scenario: 离线构建应用包 编写 e2e 测试
- [x] 7.24 [GREEN] 为 cli-tool > Scenario: 安装并打开本地应用 编写 e2e 测试
- [x] 7.25 [GREEN] 为 cli-tool > Scenario: 指定 profile 上传 编写 e2e 测试
- [x] 7.26 [GREEN] 为 upload-atomic-deploy > Scenario: 发布到指定 Server 编写 e2e 测试
- [x] 7.27 [GREEN] 为 upload-atomic-deploy > Scenario: 本地数据不随发布上传 编写 e2e 测试
- [x] 7.28 执行 Local Runtime、CLI、Desktop、生产 Server、init-repo 和平台回归测试
- [x] 7.29 在无系统 Node 的 Desktop bundle 中安装并同时运行两个应用，记录资源与故障隔离验收结果

## 8. 合入前检视修复

- [x] 8.1 补齐 Desktop 发布的远端数据库兼容验证和正式部署验证，并固定复用同一 ResolvedTarget
- [x] 8.2 在安装或升级前静默 Local Runtime，事务完成后恢复服务，覆盖在线写入与升级竞争
- [x] 8.3 对新安装版本执行入口、backend contract 和 Runtime 健康检查，失败时恢复旧版本与数据库
- [x] 8.4 将逐应用运行状态和失败原因暴露给 Desktop，并在应用库展示可操作错误
- [x] 8.5 在 Desktop 启动和打开应用前自检 `*.localhost` 回环解析，失败时返回可操作诊断
- [x] 8.6 补充上述缺口的聚焦测试，重跑全量回归和无系统 Node bundle 验收

## 9. 独立检视补强

- [x] 9.1 为 Local Platform Shell 实现与 hosted/dev 一致的平台 capability request/response host，覆盖身份、时间、复制、下载、确认、路由和 AI overlay
- [x] 9.2 将 manifest 自定义 `distDir`、`backend.root` 和 `backend.include` 规范化进 `.localapp` 固定布局，并覆盖本地运行与远端发布
- [x] 9.3 将 Desktop 应用注册表与 Runtime 注册表切换收敛为可回滚事务，任何写入或回滚失败都返回完整错误且不遗留失效 currentVersion
- [x] 9.4 让 `localapp local install` 输出应用标识、版本和明确的可打开状态
- [x] 9.5 补充上述路径的聚焦测试并重跑全量回归；将真实 Windows VM/NSIS 验收保留为发布前外部门禁并明确记录
- [x] 9.6 将安装升级和删除收敛为持久化事务日志，覆盖进程中断恢复、非法应用 ID 与损坏日志启动容错
- [x] 9.7 校验事务快照 checksum、注册表路径与 SQLite 完整性，以提交标记区分成功事务并覆盖候选 Runtime 提交失败
- [x] 9.8 在删除恢复时从 Local Registry 重建 Runtime Registry，并将可见提交回执定义为不可逆提交点

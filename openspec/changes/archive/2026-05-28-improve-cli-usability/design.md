## Context

CLI 的 `init` 命令在 `init.rs:190-191` 无条件调用 `Config::load()`，即使使用 `--builtin-repo --skip-deploy`（纯本地初始化）也强制要求登录。这阻止了新用户在无服务端环境下的首次体验。

`login` 命令使用 `dialoguer` crate 的交互式输入，没有命令行参数方式，导致 CI/CD 和自动化脚本无法使用。用户只能通过环境变量 `LOCALAPP_SERVER_URL` / `LOCALAPP_API_KEY` 或手动写 `~/.localapp/work/config.json` 绕过。

## Goals / Non-Goals

**Goals:**
- `init --builtin-repo --skip-deploy` 无需登录即可完成本地项目初始化
- `login` 支持 `--server-url` 和 `--api-key` 参数实现非交互式配置
- 现有交互式 `login` 流程和行为完全不变
- 现有需要登录的 init 流程（无 `--skip-deploy` 或需要服务端模板）继续正常工作

**Non-Goals:**
- 不改变其他命令的登录要求（upload、schemas 等仍然需要配置）
- 不改变 `Config` 结构或配置文件格式
- 不涉及 Server 端修改

## Decisions

### Decision 1: init 在 builtin-repo + skip-deploy 时提前返回

在 `Config::load()` 之后、`.ok_or()` 检查之前插入 `builtin_repo && skip_deploy` 的提前返回分支：
- `Config::load()` 返回 `Option<Config>`，配置文件缺失时返回 `None`，不会 panic
- 提前返回路径：提取内置模板 → 写入项目文件（serverUrl 为空字符串）→ 输出 `{"created":"<name>"}` → 返回
- 其他路径：落入原有的 `.ok_or("Not configured...")` 检查，行为不变

`dev-config.json` 的 `serverUrl` 在无配置时写入空字符串 `""`。

**替代方案考虑**：允许 Config::load() 返回 None 但继续执行 → 放弃，因为会让错误处理更复杂。条件化更清晰。

### Decision 2: login 新增可选参数，不替换 dialoguer

在 main.rs 的 Login 变体中新增 `server_url` 和 `api_key` 两个 `Option<String>` 参数。当两者都提供时，跳过 dialoguer，直接保存配置。当任一缺失时，退回到现有的交互式流程。

**替代方案考虑**：用环境变量替代命令行参数 → 放弃，命令行参数更适合一次性配置场景，环境变量已支持（LOCALAPP_SERVER_URL / LOCALAPP_API_KEY）但不够直观。

## Risks / Trade-offs

- **风险**: `--builtin-repo --skip-deploy` 无登录时 `dev-config.json` 的 `serverUrl` 为空 → **缓解**: 用户后续执行 `localapp login` 或需要部署时，`dev-config.json` 中的空值不影响，部署时仍会从 `Config::load()` 读取正确的 serverUrl
- **风险**: 非交互式 login 不验证 serverUrl 格式和 apiKey 有效性 → **缓解**: 与其他配置方式（环境变量、手动文件）行为一致，由首次实际 API 调用时验证

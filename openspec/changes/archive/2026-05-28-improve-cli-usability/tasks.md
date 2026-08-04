## 1. Login 非交互式参数

- [x] 1.1 `main.rs`: Login 变体新增 `--server-url` 和 `--api-key` 可选参数定义
- [x] 1.2 `login.rs`: 当 `--server-url` 和 `--api-key` 均提供时跳过 dialoguer，直接保存配置
- [x] 1.3 `login.rs`: 当仅提供其中一个参数时，将其作为 dialoguer 的默认值，仍交互式输入

## 2. Init 解耦登录

- [x] 2.1 `init.rs`: 当 `builtin_repo && skip_deploy` 时跳过 `Config::load()` + Client 创建 + `/api/config` 调用
- [x] 2.2 `init.rs`: 无登录时 `dev-config.json` 的 `serverUrl` 写入空字符串 `""`
- [x] 2.3 `init.rs`: 仅 `--builtin-repo`（无 `--skip-deploy`）时仍要求登录

## 3. 构建与验证

- [x] 3.1 编译 CLI: `cargo build --release`
- [x] 3.2 验证: 无登录下执行 `localapp init --name test --builtin-repo --skip-deploy` 成功
- [x] 3.3 验证: `localapp login --server-url http://localhost:3000 --api-key sk-xxx` 非交互式配置成功
- [x] 3.4 验证: `localapp login`（无参数）交互式行为不变

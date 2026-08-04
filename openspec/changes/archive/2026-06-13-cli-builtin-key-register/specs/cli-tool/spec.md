## MODIFIED Requirements

### Requirement: login 命令

CLI SHALL 提供 `login` 命令，交互式收集 serverUrl，并自动尝试使用内置 registration key 和 OS 用户名向服务端注册。帮助文本 SHALL 使用中文描述命令用途。SHALL 支持通过 `--server-url` 和 `--api-key` 参数进行非交互式配置，两者均提供时跳过交互式输入和自动注册。

login 命令 SHALL 按以下顺序执行：
1. 若 `--server-url` 和 `--api-key` 均提供 → 非交互式保存（跳过自动注册）
2. 交互式输入 server URL
3. 若无现有配置或 api_key 为空 → 用内置 registration key（编译时注入）+ OS 用户名调用 `POST /api/auth/cli-register`
   - 成功（200）→ 保存返回的 api_key，完成
   - 失败（409 用户已存在 / 403 key 无效或 pattern 不匹配 / 其他错误）→ 回退交互式输入 api_key
4. 回退路径：交互式输入 api_key（Password 对话框）

CLI SHALL NOT 提供 `--registration-key` 参数。registration key SHALL 在编译时通过 `build.rs` 从共享文件注入。

#### Scenario: 首次登录 — 自动注册成功
- **WHEN** 执行 `localapp login`（无参数），输入 server URL，内置 key 有效且 OS 用户名匹配 pattern，用户不存在
- **THEN** 自动注册成功，保存 api_key 到 config.json，输出 `{"success": true}`，不提示输入 api_key

#### Scenario: 首次登录 — 自动注册失败回退（key 无效或 pattern 不匹配）
- **WHEN** 执行 `localapp login`（无参数），输入 server URL，自动注册返回 403
- **THEN** 回退到交互式输入 api_key

#### Scenario: 首次登录 — 用户已存在回退
- **WHEN** 执行 `localapp login`（无参数），输入 server URL，自动注册返回 409
- **THEN** 回退到交互式输入 api_key

#### Scenario: 非交互式配置
- **WHEN** 执行 `localapp login --server-url http://localhost:3000 --api-key sk-xxx`
- **THEN** 跳过交互式输入和自动注册，直接保存配置，输出 `{"success": true}`

#### Scenario: 更新配置
- **WHEN** 执行 `localapp login` 且配置文件已存在
- **THEN** 提示输入新的 serverUrl（显示当前值作为默认），若 api_key 为空则尝试自动注册

#### Scenario: 帮助文本为中文
- **WHEN** 执行 `localapp login --help`
- **THEN** 显示中文命令描述，不包含 `--registration-key` 参数

## ADDED Requirements

### Requirement: Registration key 编译时注入

CLI binary SHALL 在编译时通过 `build.rs` 从共享文件 `packages/shared/.registration-key` 读取 registration key，通过 `env!()` 宏注入为编译时常量。SHALL NOT 在运行时从文件或环境变量读取 registration key。

`build.rs` SHALL 设置 `cargo:rerun-if-changed` 指向共享文件，确保 key 文件变更时触发重新编译。

#### Scenario: 编译时 key 注入成功
- **WHEN** 执行 `cargo build` 且共享文件 `packages/shared/.registration-key` 存在
- **THEN** key 被编译进 binary，`login` 命令自动注册时使用该 key

#### Scenario: 共享文件缺失时编译失败
- **WHEN** 执行 `cargo build` 且共享文件 `packages/shared/.registration-key` 不存在
- **THEN** 编译失败，错误信息提示运行 `pnpm setup` 生成 key 文件

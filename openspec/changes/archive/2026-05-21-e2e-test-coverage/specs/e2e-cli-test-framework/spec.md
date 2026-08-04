## ADDED Requirements

### Requirement: CLI 二进制编译与定位

测试框架 SHALL 在测试前编译 Rust CLI 并定位二进制路径。

#### Scenario: 首次运行自动编译
- **WHEN** `packages/cli/target/debug/` 下不存在 CLI 二进制
- **THEN** 执行 `cargo build` 编译，二进制路径为 `packages/cli/target/debug/localapp-cli`（或 `.exe`）

#### Scenario: 二进制已存在时跳过编译
- **WHEN** CLI 二进制已存在
- **THEN** 跳过编译，直接使用已有二进制

### Requirement: 测试用 Server 启动

每个测试套件 SHALL 启动独立的 Server 实例，使用随机端口和临时数据目录。

#### Scenario: Server 启动与配置
- **WHEN** 测试套件初始化
- **THEN** 启动 Fastify Server（随机端口），设置 `BOOTSTRAP_API_KEY`，返回 baseUrl 和 apiKey

#### Scenario: 测试套件结束后清理
- **WHEN** 测试套件结束
- **THEN** 关闭 Server，删除临时数据目录

### Requirement: CLI 子进程执行器

测试框架 SHALL 提供 `runCli(args, options)` 辅助函数，通过子进程执行 CLI 命令。

#### Scenario: 执行成功命令
- **WHEN** 调用 `runCli(["pages", "list"])` 且命令成功
- **THEN** 返回 `{ exitCode: 0, stdout: "...", stderr: "" }`，stdout 为 JSON

#### Scenario: 执行失败命令
- **WHEN** 调用 `runCli(["new"])` 但未配置
- **THEN** 返回 `{ exitCode: 1, stdout: "", stderr: '{"error":"..."}' }`

#### Scenario: 指定工作目录和环境变量
- **WHEN** 调用 `runCli(["new"], { cwd: "/tmp/project", env: { LOCALAPP_SERVER_URL: "...", LOCALAPP_API_KEY: "..." } })`
- **THEN** 在指定工作目录下执行，注入环境变量

### Requirement: 临时项目目录

测试框架 SHALL 为每个测试提供独立的临时工作目录，用于 `.localapp.json` 和上传文件。

#### Scenario: 创建临时项目目录
- **WHEN** 测试需要模拟项目目录
- **THEN** 创建临时目录，可放置 `index.html` 等文件，测试结束后自动清理

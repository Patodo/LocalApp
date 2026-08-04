## Purpose

CLI 端到端测试框架。提供 Server 启停、CLI 子进程执行器、临时目录管理，支撑所有 CLI 命令的 e2e 测试。

## Requirements

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

### Requirement: 安全与授权边界测试

E2E 测试 SHALL 覆盖安全注入防御和授权边界场景，包括 SQL 注入、XSS、非 owner 操作拦截和上传限制。

#### Scenario: CRUD filter SQL 注入被安全处理
- **WHEN** 对 CRUD 列表接口传入恶意 filter 参数（如 `?done=1; DROP TABLE todos--`）
- **THEN** 返回正常结果或空列表，数据表未被破坏

#### Scenario: 上传 HTML 含 XSS 脚本时 CSP 生效
- **WHEN** 上传包含 `<script>alert('xss')</script>` 的 index.html
- **THEN** 静态文件服务返回的响应包含 CSP header（限制 script-src），页面内容原样返回（由浏览器执行 CSP 策略）

#### Scenario: 非 owner PUT 其他用户页面返回 403
- **WHEN** 用户 A 尝试 PUT /api/pages/:name 修改属于用户 B 的页面
- **THEN** 返回 403 Forbidden

#### Scenario: 非 owner DELETE 其他用户页面返回 403
- **WHEN** 用户 A 尝试 DELETE /api/pages/:name 删除属于用户 B 的页面
- **THEN** 返回 403 Forbidden

#### Scenario: 页面级 acl 模式拒绝非列表用户
- **WHEN** 页面设置为 `pageAccess.level = "acl"` 且 acl 列表包含用户 A，用户 B 尝试访问该页面
- **THEN** 返回 403 Forbidden

#### Scenario: 页面级 acl 模式允许列表内用户
- **WHEN** 页面设置为 `pageAccess.level = "acl"` 且 acl 列表包含用户 A，用户 A 尝试访问该页面
- **THEN** 返回 200 成功

### Requirement: 上传限制边界测试

E2E 测试 SHALL 覆盖上传限制的边界条件，确保超限请求被正确拒绝。

#### Scenario: 单次上传超过 50MB 返回 413
- **WHEN** 上传文件总大小超过 50MB
- **THEN** 返回 413 Payload Too Large

#### Scenario: POST /api/pages 缺少 name 返回 400
- **WHEN** POST /api/pages 请求体为空 JSON `{}`
- **THEN** 返回 400 Bad Request

#### Scenario: GET /api/schemas 缺少 pageName 返回 400
- **WHEN** GET /api/schemas 不携带 pageName 参数
- **THEN** 返回 400 Bad Request

#### Scenario: DELETE /api/schemas/:name 缺少 pageName 返回 400
- **WHEN** DELETE /api/schemas/todos 不携带 pageName 参数
- **THEN** 返回 400 Bad Request

#### Scenario: POST /api/schemas 缺少 fields 返回错误
- **WHEN** POST /api/schemas 只传 name 和 pageName，不传 fields
- **THEN** 返回错误响应（400 或 500）

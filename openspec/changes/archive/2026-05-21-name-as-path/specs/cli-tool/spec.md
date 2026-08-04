## MODIFIED Requirements

### Requirement: new 命令

CLI SHALL 提供 `new` 命令，读取 manifest.json 中的 name，在服务端创建页面。manifest.json 中不再写入 pageId。

#### Scenario: 成功创建
- **WHEN** 执行 `localapp new` 且已配置 serverUrl 和 apiKey，manifest.json 包含合法 name
- **THEN** POST `/api/pages`（携带 name），服务端返回页面信息，输出 `{ "name": "...", "url": "..." }`

#### Scenario: 未登录
- **WHEN** 执行 `localapp new` 且未配置 serverUrl 或 apiKey
- **THEN** 输出错误 JSON `{"error": "Not configured. Run 'localapp login' first."}`

#### Scenario: 无 manifest.json
- **WHEN** 执行 `localapp new` 但当前目录没有 manifest.json
- **THEN** 输出错误 JSON `{"error": "No manifest.json found. Run 'localapp init' first."}`

#### Scenario: manifest.json 无 name
- **WHEN** 执行 `localapp new`，manifest.json 存在但 name 字段为空
- **THEN** 输出错误 JSON `{"error": "No name in manifest.json"}`

#### Scenario: 页面已存在
- **WHEN** 执行 `localapp new`，但服务端该用户下已有同名页面
- **THEN** 输出错误 JSON `{"error": "Page name already exists"}`

### Requirement: upload 命令

CLI SHALL 提供 `upload <path>` 命令，从 manifest.json 读取 name，将文件上传到对应页面。上传时每个文件 part 前附带 `filepath_{index}` 字段保留子目录结构。

#### Scenario: 成功上传
- **WHEN** 执行 `localapp upload ./dist`，manifest.json 存在且包含 name，目录包含文件
- **THEN** 递归读取目录文件，multipart POST 到 `/api/upload`（带 name 和 filepath 字段），输出 `{ "name", "url", "version" }`

#### Scenario: 无 manifest.json
- **WHEN** 执行 `localapp upload ./dist` 但当前目录没有 manifest.json
- **THEN** 输出错误 JSON `{"error": "No manifest.json found. Run 'localapp init' first."}`

#### Scenario: manifest.json 无 name
- **WHEN** 执行 `localapp upload ./dist`，manifest.json 存在但 name 为空
- **THEN** 输出错误 JSON `{"error": "No name in manifest.json"}`

#### Scenario: 目录不存在
- **WHEN** 指定的 path 不存在或不是目录
- **THEN** 输出错误 JSON `{"error": "Directory not found: <path>"}`

#### Scenario: 上传含子目录的文件保留路径
- **WHEN** 执行 `localapp upload ./dist`，dist 包含 `index.html` 和 `assets/style.css`
- **THEN** CLI 发送 `filepath_0: "index.html"`、`filepath_1: "assets/style.css"` 字段，服务端按路径存储

### Requirement: pages 子命令

CLI SHALL 提供 `pages` 子命令组：`list`、`info [name]`、`delete [name]`。name 参数可选，默认从 manifest.json 读取。

#### Scenario: 列出页面
- **WHEN** 执行 `localapp pages list`
- **THEN** GET `/api/pages`，输出 JSON 页面列表

#### Scenario: 页面详情（从配置读取）
- **WHEN** 执行 `localapp pages info`（无参数），manifest.json 存在且包含 name
- **THEN** GET `/api/pages/{name}`（从 manifest.json 读取），输出页面详情

#### Scenario: 页面详情（指定 name）
- **WHEN** 执行 `localapp pages info my-cool-app`
- **THEN** GET `/api/pages/my-cool-app`，输出页面详情

#### Scenario: 删除页面
- **WHEN** 执行 `localapp pages delete my-cool-app`
- **THEN** DELETE `/api/pages/my-cool-app`，输出删除确认

### Requirement: schemas 子命令

CLI SHALL 提供 `schemas` 子命令组：`create <name> --fields <json>`、`list`、`delete <name>`。支持可选 `[name]` 参数标识页面，默认从 manifest.json 读取。

#### Scenario: 创建 schema
- **WHEN** 执行 `localapp schemas create todos --fields '{"title":{"type":"string"}}'`
- **THEN** POST `/api/schemas`（带页面 name），输出 schema 信息含 endpoints

#### Scenario: 列出 schemas
- **WHEN** 执行 `localapp schemas list`
- **THEN** GET `/api/schemas?name=...`（从 manifest.json 读取），输出 schema 列表

#### Scenario: 删除 schema
- **WHEN** 执行 `localapp schemas delete todos`
- **THEN** DELETE `/api/schemas/todos?name=...`，输出删除确认

### Requirement: init 命令 name 验证

CLI `init` 命令 SHALL 使用与 server 一致的 name 验证规则：小写字母+数字+连字符，字母开头，3-63 字符，禁止连续连字符和首尾连字符，禁止保留词。

#### Scenario: 合法 name
- **WHEN** 执行 `localapp init my-cool-app`
- **THEN** 创建 manifest.json，name 字段为 `my-cool-app`

#### Scenario: 非法 name（大写）
- **WHEN** 执行 `localapp init My-Cool-App`
- **THEN** 输出错误，提示 name 规则

#### Scenario: 非法 name（保留词）
- **WHEN** 执行 `localapp init api`
- **THEN** 输出错误，提示 name 为保留词

#### Scenario: 非法 name（数字开头）
- **WHEN** 执行 `localapp init 123app`
- **THEN** 输出错误，提示 name 必须字母开头

### Requirement: CLI new 命令端到端验证

e2e 测试 SHALL 验证 `new` 命令的完整行为。

#### Scenario: 成功创建
- **WHEN** 执行 `localapp new` 且已通过环境变量配置，manifest.json 包含合法 name
- **THEN** CLI 输出 `{ "name": "...", "url": "..." }` 到 stdout，退出码 0

#### Scenario: 未配置时创建失败
- **WHEN** 执行 `localapp new` 但未设置 `LOCALAPP_SERVER_URL` 或 `LOCALAPP_API_KEY`
- **THEN** CLI 输出 `{"error":"Not configured..."}` 到 stderr，退出码 1

#### Scenario: 无 manifest.json 时创建失败
- **WHEN** 执行 `localapp new` 但当前目录没有 manifest.json
- **THEN** CLI 输出 `{"error":"No manifest.json found..."}` 到 stderr，退出码 1

### Requirement: CLI pages 子命令端到端验证

e2e 测试 SHALL 验证 `pages` 子命令的完整行为。

#### Scenario: 列出页面
- **WHEN** 执行 `localapp pages list` 且已创建若干页面
- **THEN** 输出 JSON 数组，包含已创建页面的 name 和时间戳

#### Scenario: 查看页面详情
- **WHEN** 执行 `localapp pages info`（从 manifest.json 读取 name）
- **THEN** 输出页面详情 JSON，包含 name、currentVersion 等

#### Scenario: 删除页面
- **WHEN** 执行 `localapp pages delete <name>`
- **THEN** 输出 `{ "deleted": true, "name": "..." }`

#### Scenario: 删除不存在的页面
- **WHEN** 执行 `localapp pages delete nonexistent`
- **THEN** 输出错误到 stderr，退出码 1

### Requirement: CLI schemas 子命令端到端验证

e2e 测试 SHALL 验证 `schemas` 子命令的完整行为。

#### Scenario: 创建 schema
- **WHEN** 执行 `localapp schemas create todos --fields '{"title":{"type":"string","constraints":{"required":true}}}'`
- **THEN** 输出 schema 信息，包含 name、fields、endpoints

#### Scenario: 列出 schemas
- **WHEN** 执行 `localapp schemas list`
- **THEN** 输出 schema 数组

#### Scenario: 删除 schema
- **WHEN** 执行 `localapp schemas delete todos`
- **THEN** 输出删除确认

### Requirement: 完整工作流端到端验证

e2e 测试 SHALL 验证 init → new → upload → pages info → serve 完整工作流。

#### Scenario: init → new → upload → pages info → serve 完整流程
- **WHEN** 依次执行 `localapp init my-app`、`localapp new`、创建测试文件、`localapp upload ./dist`、`localapp pages info`
- **THEN** 每步输出正确，最终通过 HTTP 访问 `/serve/{userId}/my-app` 可获得上传的 `index.html`

## REMOVED Requirements

### Requirement: 已有 .localapp.json
**Reason**: 配置文件从 `.localapp.json` 改为 `manifest.json`，此场景已在 init 命令中由 "manifest.json already exists" 覆盖
**Migration**: 使用 `localapp init` 创建 manifest.json

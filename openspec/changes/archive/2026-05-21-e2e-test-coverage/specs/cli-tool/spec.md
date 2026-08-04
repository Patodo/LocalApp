## ADDED Requirements

### Requirement: CLI new 命令端到端验证

#### Scenario: 成功创建并生成 .localapp.json
- **WHEN** 执行 `localapp new` 且已通过环境变量配置
- **THEN** CLI 输出 `{ "pageId": "...", "url": "..." }` 到 stdout，退出码 0；当前目录生成 `.localapp.json` 包含 `{ "page_id": "..." }`

#### Scenario: 未配置时创建失败
- **WHEN** 执行 `localapp new` 但未设置 `LOCALAPP_SERVER_URL` 或 `LOCALAPP_API_KEY`
- **THEN** CLI 输出 `{"error":"Not configured..."}` 到 stderr，退出码 1

#### Scenario: 目录已有项目时创建失败
- **WHEN** 执行 `localapp new` 但当前目录已存在 `.localapp.json`
- **THEN** CLI 输出 `{"error":"Project already exists in this directory"}` 到 stderr，退出码 1

### Requirement: CLI pages 子命令端到端验证

#### Scenario: 列出页面
- **WHEN** 执行 `localapp pages list` 且已创建若干页面
- **THEN** 输出 JSON 数组，包含已创建页面的 pageId 和时间戳

#### Scenario: 查看页面详情
- **WHEN** 执行 `localapp pages info`（从 .localapp.json 读取 pageId）
- **THEN** 输出页面详情 JSON，包含 pageId、currentVersion、versions 等

#### Scenario: 删除页面
- **WHEN** 执行 `localapp pages delete <pageId>`
- **THEN** 输出 `{ "deleted": true, "pageId": "..." }`

#### Scenario: 删除不存在的页面
- **WHEN** 执行 `localapp pages delete nonexistent`
- **THEN** 输出错误到 stderr，退出码 1

### Requirement: CLI schemas 子命令端到端验证

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

#### Scenario: new → upload → pages info → serve 完整流程
- **WHEN** 依次执行 `localapp new`、创建测试文件、`localapp upload ./dist`、`localapp pages info`
- **THEN** 每步输出正确，最终通过 HTTP 访问 `/serve/{userId}/{pageId}` 可获得上传的 `index.html`

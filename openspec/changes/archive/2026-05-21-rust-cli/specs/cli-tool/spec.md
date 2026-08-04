## ADDED Requirements

### Requirement: login 命令

CLI SHALL 提供 `login` 命令，交互式收集 serverUrl 和 apiKey，保存到 `~/.localapp/work/config.json`。

#### Scenario: 首次配置
- **WHEN** 执行 `localapp login` 且 `~/.localapp/work/config.json` 不存在
- **THEN** 提示输入 serverUrl 和 apiKey，创建配置文件，输出 `{"success": true}`

#### Scenario: 更新配置
- **WHEN** 执行 `localapp login` 且配置文件已存在
- **THEN** 提示输入新的 serverUrl 和 apiKey（显示当前值作为默认），覆盖写入

### Requirement: new 命令

CLI SHALL 提供 `new` 命令，在服务端创建空页面并将 pageId 写入当前目录的 `.localapp.json`。

#### Scenario: 成功创建
- **WHEN** 执行 `localapp new` 且已配置 serverUrl 和 apiKey
- **THEN** POST `/api/pages`，服务端返回 pageId，CLI 将 `{ "pageId": "..." }` 写入当前目录 `.localapp.json`，输出 `{ "pageId": "...", "url": "..." }`

#### Scenario: 未登录
- **WHEN** 执行 `localapp new` 且未配置 serverUrl 或 apiKey
- **THEN** 输出错误 JSON `{"error": "Not configured. Run 'localapp login' first."}`

#### Scenario: 已有 .localapp.json
- **WHEN** 执行 `localapp new` 且当前目录已存在 `.localapp.json`
- **THEN** 输出错误 JSON `{"error": "Project already exists in this directory"}`

### Requirement: upload 命令

CLI SHALL 提供 `upload <path>` 命令，将指定目录的文件上传到 `.localapp.json` 中对应的页面。不接受 `--page-id` 参数。

#### Scenario: 成功上传
- **WHEN** 执行 `localapp upload ./dist`，`.localapp.json` 存在且有效，目录包含文件
- **THEN** 递归读取目录文件，multipart POST 到 `/api/upload`（带 pageId），输出 `{ "pageId", "url", "version" }`

#### Scenario: 无 .localapp.json
- **WHEN** 执行 `localapp upload ./dist` 但当前目录没有 `.localapp.json`
- **THEN** 输出错误 JSON `{"error": "No project found. Run 'localapp new' first."}`

#### Scenario: 目录不存在
- **WHEN** 指定的 path 不存在或不是目录
- **THEN** 输出错误 JSON `{"error": "Directory not found: <path>"}`

### Requirement: pages 子命令

CLI SHALL 提供 `pages` 子命令组：`list`、`info [pageId]`、`delete [pageId]`。

#### Scenario: 列出页面
- **WHEN** 执行 `localapp pages list`
- **THEN** GET `/api/pages`，输出 JSON 页面列表

#### Scenario: 页面详情（从配置读取）
- **WHEN** 执行 `localapp pages info`（无参数），`.localapp.json` 存在
- **THEN** GET `/api/pages/{pageId}`（从 .localapp.json 读取），输出页面详情

#### Scenario: 页面详情（指定 pageId）
- **WHEN** 执行 `localapp pages info abc123`
- **THEN** GET `/api/pages/abc123`，输出页面详情

#### Scenario: 删除页面
- **WHEN** 执行 `localapp pages delete abc123`
- **THEN** DELETE `/api/pages/abc123`，输出删除确认

### Requirement: schemas 子命令

CLI SHALL 提供 `schemas` 子命令组：`create <name> --fields <json>`、`list`、`delete <name>`。支持可选 `[pageId]` 参数，默认从 `.localapp.json` 读取。

#### Scenario: 创建 schema
- **WHEN** 执行 `localapp schemas create todos --fields '{"title":{"type":"string"}}'`
- **THEN** POST `/api/schemas`（带 pageId），输出 schema 信息含 endpoints

#### Scenario: 列出 schemas
- **WHEN** 执行 `localapp schemas list`
- **THEN** GET `/api/schemas?pageId=...`（从 .localapp.json 读取），输出 schema 列表

#### Scenario: 删除 schema
- **WHEN** 执行 `localapp schemas delete todos`
- **THEN** DELETE `/api/schemas/todos?pageId=...`，输出删除确认

### Requirement: 配置优先级

CLI SHALL 按以下优先级解析配置：环境变量 > `~/.localapp/work/config.json`。

#### Scenario: 环境变量覆盖配置文件
- **WHEN** `LOCALAPP_SERVER_URL` 和 `LOCALAPP_API_KEY` 环境变量已设置，同时 `config.json` 也存在
- **THEN** 使用环境变量的值

#### Scenario: 仅配置文件
- **WHEN** 环境变量未设置，`config.json` 存在
- **THEN** 使用配置文件的值

#### Scenario: 无配置
- **WHEN** 环境变量未设置且 `config.json` 不存在
- **THEN** 输出错误提示先运行 `localapp login`

### Requirement: JSON 输出格式

所有命令 SHALL 输出 JSON 到 stdout，错误信息输出到 stderr。

#### Scenario: 成功输出
- **WHEN** 命令执行成功
- **THEN** stdout 输出 JSON 对象，包含操作结果数据

#### Scenario: 错误输出
- **WHEN** 命令执行失败
- **THEN** stderr 输出 JSON `{"error": "..."}` ，退出码非 0

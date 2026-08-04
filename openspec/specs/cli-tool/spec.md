## Purpose

CLI 命令行工具。提供 login、new、upload、pages、schemas、update 等子命令，通过 HTTP API 与 Server 交互。
## Requirements
### Requirement: login 命令

CLI SHALL 提供 `login` 命令，交互式收集 Server URL 和 API Key。帮助文本 SHALL 使用中文描述命令用途。CLI SHALL 支持通过 `--server-url` 和 `--api-key` 参数进行非交互式登录。

login 命令 MUST 在保存配置前使用候选 API Key 请求目标 Server 的 `GET /api/me`。只有 Server 返回已认证用户对象时才能原子保存配置；验证或写入失败时已有配置 MUST 保持不变。CLI MUST NOT 尝试自动注册，也 MUST NOT 提供或读取 registration key。

#### Scenario: 首次交互式登录成功
- **WHEN** 执行 `localapp login`，输入 Server URL 和有效 API Key
- **THEN** CLI 调用 `GET /api/me` 验证身份
- **AND** 原子保存配置并输出包含当前用户名的成功 JSON

#### Scenario: API Key 无效
- **WHEN** 登录验证返回未认证或 HTTP 401
- **THEN** CLI 输出无效 API Key 的明确错误和联系管理员的提示
- **AND** 不创建或覆盖配置

#### Scenario: Server 无法连接
- **WHEN** 登录验证发生连接、超时或协议错误
- **THEN** CLI 输出可区分的连接或协议错误
- **AND** 已有配置保持字节级不变

#### Scenario: 非交互式配置
- **WHEN** 执行 `localapp login --server-url http://localhost:3000 --api-key sk-valid`
- **THEN** 跳过交互输入但仍验证 API Key
- **AND** 验证成功后才保存配置

#### Scenario: 更新已有配置
- **WHEN** 执行 `localapp login` 且配置文件已存在
- **THEN** Server URL 使用当前值作为默认值并提示输入新 API Key
- **AND** 新配置验证成功前不修改旧配置

#### Scenario: 帮助文本为中文
- **WHEN** 执行 `localapp login --help`
- **THEN** 显示中文命令描述
- **AND** 不包含自动注册或 `--registration-key`

### Requirement: new 命令

CLI SHALL 提供 `new` 命令，读取 manifest.json 中的 name，在服务端创建页面。帮助文本 SHALL 使用中文描述命令用途，不暴露 manifest.json 等实现细节。

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

#### Scenario: 帮助文本为中文
- **WHEN** 执行 `localapp new --help`
- **THEN** 显示中文命令描述，不提及 manifest.json

### Requirement: upload 命令

CLI SHALL 提供 `upload <path>` 命令，从 manifest.json 读取 name，自动执行 SDK 刷新、构建和上传。帮助文本 SHALL 使用中文描述命令用途和参数含义。

upload 命令 SHALL 按以下顺序执行：
1. 读取 manifest.json 获取 name 和 distDir
2. 用内置模板覆盖用户项目的 `src/lib/localapp/`（SDK 自动刷新）
3. 执行 `npm run build` 构建
4. 收集构建产物并上传

#### Scenario: 成功上传（完整流程）
- **WHEN** 执行 `localapp upload`，manifest.json 存在且包含 name
- **THEN** 刷新 SDK → 构建 → 收集 dist 文件 → multipart POST 到 `/api/upload`，输出 `{ "name", "url", "version" }`

#### Scenario: 指定路径上传
- **WHEN** 执行 `localapp upload ./custom-dist`
- **THEN** 使用指定路径作为 dist 目录，跳过 SDK 刷新和构建步骤，直接收集并上传指定目录

#### Scenario: 无 manifest.json
- **WHEN** 执行 `localapp upload` 但当前目录没有 manifest.json
- **THEN** 输出错误 JSON `{"error": "No manifest.json found. Run 'localapp init' first."}`

#### Scenario: manifest.json 无 name
- **WHEN** 执行 `localapp upload`，manifest.json 存在但 name 为空
- **THEN** 输出错误 JSON `{"error": "No name in manifest.json"}`

#### Scenario: 构建失败
- **WHEN** `npm run build` 执行失败（编译错误等）
- **THEN** 输出错误信息到 stderr，退出码非 0，不执行上传

#### Scenario: 帮助文本为中文
- **WHEN** 执行 `localapp upload --help`
- **THEN** path 参数描述为中文，说明不指定路径时自动构建并上传

#### Scenario: 上传含子目录的文件保留路径
- **WHEN** 构建产物包含 `index.html` 和 `assets/style.css`
- **THEN** CLI 发送 `filepath_0: "index.html"`、`filepath_1: "assets/style.css"` 字段，服务端按路径存储

### Requirement: pages 子命令

CLI SHALL 提供 `pages` 子命令组：`list`、`info [name]`、`delete [name]`。帮助文本 SHALL 使用中文描述各子命令用途。

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

#### Scenario: 帮助文本为中文
- **WHEN** 执行 `localapp pages --help` 或 `localapp pages list --help`
- **THEN** 显示中文子命令描述

### Requirement: schemas 子命令

CLI SHALL 提供 `schemas` 子命令组：`create <name> --fields <json>`、`list`、`delete <name>`。帮助文本 SHALL 使用中文描述各子命令用途和参数含义。

#### Scenario: 创建 schema
- **WHEN** 执行 `localapp schemas create todos --fields '{"title":{"type":"string"}}'`
- **THEN** POST `/api/schemas`（带页面 name），输出 schema 信息含 endpoints

#### Scenario: 列出 schemas
- **WHEN** 执行 `localapp schemas list`
- **THEN** GET `/api/schemas?name=...`（从 manifest.json 读取），输出 schema 列表

#### Scenario: 删除 schema
- **WHEN** 执行 `localapp schemas delete todos`
- **THEN** DELETE `/api/schemas/todos?name=...`，输出删除确认

#### Scenario: 帮助文本为中文
- **WHEN** 执行 `localapp schemas --help` 或 `localapp schemas create --help`
- **THEN** 显示中文子命令描述，fields 参数说明为中文

### Requirement: update 命令

CLI SHALL 提供 `update` 子命令，从已配置的 Server 下载最新二进制并替换当前运行的 CLI。帮助文本 SHALL 使用中文描述命令用途。

#### Scenario: 成功更新
- **WHEN** 执行 `localapp update`，Server 返回版本信息且存在对应平台的二进制
- **THEN** 下载二进制到临时文件，移动替换当前可执行文件，输出 `{"success": true, "version": "<new_version>"}`

#### Scenario: 已是最新版本
- **WHEN** 执行 `localapp update`，CLI 版本等于 Server 返回的 `latest`
- **THEN** 输出 `{"success": true, "message": "Already up to date (v<version>)"}`

#### Scenario: 未配置 Server
- **WHEN** 执行 `localapp update` 且未配置 serverUrl 或 apiKey
- **THEN** 输出错误 JSON `{"error": "Not configured. Run 'localapp login' first."}`

#### Scenario: 帮助文本为中文
- **WHEN** 执行 `localapp update --help`
- **THEN** 显示中文命令描述

### Requirement: init 命令

CLI SHALL 提供 `init --name <name>` 命令创建新项目。帮助文本 SHALL 使用中文描述命令用途和各参数含义。

#### Scenario: 帮助文本为中文
- **WHEN** 执行 `localapp init --help`
- **THEN** 显示中文命令描述，name 和 description 参数说明为中文，skip_deploy 参数说明为中文

### Requirement: admin 子命令

CLI SHALL 提供 `admin` 子命令组：`users`、`pages`、`stats`。帮助文本 SHALL 使用中文描述命令用途。

#### Scenario: 帮助文本为中文
- **WHEN** 执行 `localapp admin --help`
- **THEN** 显示中文子命令描述

### Requirement: 顶层 help 文本

CLI 顶层 `about` 描述 SHALL 使用中文，提供一句话工具用途说明。`--help` 输出 SHALL 让用户快速理解工具能做什么。

#### Scenario: 顶层帮助为中文
- **WHEN** 执行 `localapp --help`
- **THEN** 显示中文 about 描述和中文子命令列表

#### Scenario: 版本信息
- **WHEN** 执行 `localapp --version`
- **THEN** 显示版本号

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

### Requirement: init 命令 name 验证

CLI `init` 命令 SHALL 使用与 server 一致的 name 验证规则：小写字母+数字+连字符，字母开头，3-63 字符，禁止连续连字符和首尾连字符，禁止保留词。init 成功后 SHALL 在项目目录下创建 `.localapp/dev-config.json`，包含 CLI 配置中的服务器地址。

#### Scenario: 合法 name
- **WHEN** 执行 `localapp init my-cool-app`
- **THEN** 创建 manifest.json 和 `.localapp/dev-config.json`，dev-config 包含 `{ "serverUrl": "<cli配置的server_url>" }`

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

### Requirement: CLI init 命令输出变更
init 命令的输出 SHALL 显示完整流程的进度信息。

#### Scenario: 进度输出
- **WHEN** init 执行完整流程
- **THEN** 每个步骤通过 stderr 输出进度信息："  ✓ Cloning template..."、"  ✓ Installing dependencies..."、"  ✓ Registering page..."、"  ✓ Building project..."、"  ✓ Uploading..."、"  ✓ Deployed!"

#### Scenario: 最终输出包含访问 URL
- **WHEN** init 完整流程执行成功
- **THEN** 通过 stdout 输出 JSON `{"created":"<name>","url":"<url>"}`，URL 从服务端 upload 响应的 `data.url` 字段获取

### Requirement: init 命令 --builtin-repo 支持下划线 alias

CLI `init` 命令的 `--builtin-repo` 参数 SHALL 同时接受 `--builtin_repo` 作为别名（alias）。两种写法 SHALL 行为完全一致。

#### Scenario: 使用下划线 alias
- **WHEN** 执行 `localapp init --name test --builtin_repo`
- **THEN** 行为与 `--builtin-repo` 完全一致，使用内置模板创建项目

#### Scenario: 使用连字符原名
- **WHEN** 执行 `localapp init --name test --builtin-repo`
- **THEN** 行为不变，正常使用内置模板创建项目

### Requirement: schemas create 支持 --file 参数

CLI `schemas create` 命令 SHALL 提供 `--file <path>` 参数，从 JSON 文件读取字段定义。`--file` 与 `--fields` SHALL 互斥，同时指定时 CLI SHALL 报错提示二选一。

#### Scenario: 从文件创建 schema
- **WHEN** 执行 `localapp schemas create bugs --file schema.json`，且 `schema.json` 包含有效字段定义 JSON
- **THEN** 读取文件内容作为 fields 参数，POST `/api/schemas`，输出 schema 信息

#### Scenario: 指定不存在的文件
- **WHEN** 执行 `localapp schemas create bugs --file nonexistent.json` 且文件不存在
- **THEN** 输出错误 "File not found: nonexistent.json"，退出码非 0

#### Scenario: 文件内容非有效 JSON
- **WHEN** 执行 `localapp schemas create bugs --file invalid.json` 且文件内容不是有效 JSON
- **THEN** 输出 JSON 解析错误信息，退出码非 0

#### Scenario: 同时指定 --file 和 --fields
- **WHEN** 执行 `localapp schemas create bugs --file schema.json --fields '{"x":{"type":"string"}}'`
- **THEN** 输出错误提示 --file 和 --fields 不能同时使用，退出码非 0

### Requirement: sync 命令

CLI SHALL 提供 `sync` 子命令，刷新当前项目的 CLI 领地（`.localapp/runtime/` 和 `.claude/skills/localapp-*/` + `agent-tool-patterns/`）到当前 CLI 二进制版本。帮助文本 SHALL 使用中文描述命令用途。

`sync` SHALL 支持以下参数：
- 无参数：默认同步模式，显示进度信息
- `--quiet`：静默模式，用于 postinstall 钩子，版本一致时输出最简、错误不阻断
- `--interactive`：交互模式，显示版本对比和变更清单，询问用户确认
- `--off`：在 `.localapp/dev-config.json` 写入 `autoSync: false`，关闭 postinstall 自动 sync
- `--on`：移除 `autoSync` 字段或设为 true，恢复 postinstall 自动 sync

#### Scenario: 帮助文本为中文
- **WHEN** 执行 `localapp sync --help`
- **THEN** 显示中文命令描述，列出 `--quiet`、`--interactive`、`--off`、`--on` 参数说明

#### Scenario: 默认同步模式输出进度
- **WHEN** 执行 `localapp sync`，runtime 版本与 CLI 不一致
- **THEN** 通过 stderr 输出每步进度（"  ✓ Removing CLI zones..."、"  ✓ Extracting runtime..."、"  ✓ Extracting skills..."），通过 stdout 输出 `{"success": true, "version": "...", "previousVersion": "..."}`

#### Scenario: --quiet 静默
- **WHEN** 执行 `localapp sync --quiet`
- **THEN** 不输出进度信息，仅输出最终 JSON 结果到 stdout

#### Scenario: --interactive 询问确认
- **WHEN** 执行 `localapp sync --interactive`
- **THEN** 显示当前版本 vs 目标版本对比、变更文件数，提示 `y/n` 确认

#### Scenario: --off 写入配置
- **WHEN** 执行 `localapp sync --off`
- **THEN** `.localapp/dev-config.json` 写入 `"autoSync": false`，stdout 输出 `{"success": true, "autoSync": false}`

#### Scenario: --on 移除配置
- **WHEN** 执行 `localapp sync --on`
- **THEN** `.localapp/dev-config.json` 移除 `autoSync` 字段（或设为 true），stdout 输出 `{"success": true, "autoSync": true}`

### Requirement: eject 命令

CLI SHALL 提供 `eject` 子命令，将 CLI 领地（`.localapp/runtime/` + `.claude/skills/localapp-*/` + `agent-tool-patterns/`）整体移出 CLI 管辖、转入用户领地，永久脱离自动更新。帮助文本 SHALL 使用中文描述命令用途、明确告知「不可逆」。

`eject` SHALL 执行：
1. 显示警告说明 eject 不可逆、失去自动更新
2. 要求用户输入 manifest.json 中的 name 确认（防误操作）
3. 校验 name 匹配，否则中止
4. `.localapp/runtime/` 移动到 `src/_localapp_runtime/`
5. `.claude/skills/localapp*/` 和 `agent-tool-patterns/` 重命名为 `custom-` 前缀
6. 用户 `package.json` 中 `@localapp/*` 的 `file:` 引用路径改为 `./src/_localapp_runtime/...`
7. 用户 `package.json` 移除 `postinstall` 钩子
8. 用户 `vite.config.ts`、`tsconfig.json` 中对 runtime 的引用改为新路径
9. `.localapp/dev-config.json` 写入 `"ejected": true`
10. 提示用户重新 `npm install` 刷新引用

#### Scenario: 帮助文本为中文且警示不可逆
- **WHEN** 执行 `localapp eject --help`
- **THEN** 显示中文命令描述，明确说明此命令不可逆、执行后失去自动更新

#### Scenario: eject 前要求项目名确认
- **WHEN** 执行 `localapp eject`，manifest.json 中 name 为 `my-app`
- **THEN** CLI 提示 "Type 'my-app' to confirm eject:"，等待用户输入

#### Scenario: 用户输入正确 name 完成 eject
- **WHEN** eject 提示后用户输入正确的项目名 `my-app`
- **THEN** CLI 执行迁移步骤：`.localapp/runtime/` 移至 `src/_localapp_runtime/`；skills 重命名为 `custom-*`；package.json 引用更新；dev-config.json 写入 `"ejected": true`；输出 `{"success": true, "ejected": true}`

#### Scenario: 用户输入错误 name 中止
- **WHEN** eject 提示后用户输入错误（如 `my-app-typo`）
- **THEN** CLI 输出 `{"error": "Project name mismatch. Eject cancelled."}`，退出码 1，不修改任何文件

#### Scenario: eject 后 npm install 可正常完成
- **WHEN** eject 完成后执行 `npm install`
- **THEN** npm install 成功，`node_modules/@localapp/*` 通过 file: 引用指向 `src/_localapp_runtime/`

#### Scenario: eject 后 npm run dev 可正常启动
- **WHEN** eject 完成后执行 `npm install && npm run dev`
- **THEN** vite dev server 正常启动，应用功能不受影响（SDK 引用路径已更新）

#### Scenario: eject 后的 sync 被拒绝
- **WHEN** eject 后执行 `localapp sync`
- **THEN** CLI 输出 `{"error": "Project has been ejected. sync is disabled..."}`，退出码 1，不修改任何文件

### Requirement: 顶层 help 文本包含 sync 和 eject

CLI 顶层 `--help` 输出 SHALL 列出 `sync` 和 `eject` 子命令，并使用中文描述用途。

#### Scenario: 顶层 help 包含新命令
- **WHEN** 执行 `localapp --help`
- **THEN** 子命令列表包含 `sync`（描述："刷新 CLI 领地到当前 CLI 版本"）和 `eject`（描述："脱离自动更新，将 CLI 领地转为用户代码"）

### Requirement: sync 命令端到端验证

e2e 测试 SHALL 验证 `sync` 命令的完整行为。

#### Scenario: 首次 sync 在新 init 项目上幂等
- **WHEN** 执行 `localapp init test-app`，cd 进 test-app，执行 `localapp sync`
- **THEN** 退出码 0，输出 `{"success": true, "version": "...", "previousVersion": "..."}`，runtime 内容与 init 后一致

#### Scenario: 模拟 CLI 升级后 sync 更新 runtime
- **WHEN** 项目内 `.localapp/runtime/version.json` 显示旧版本（手动改为 `0.0.1`），执行 `localapp sync`
- **THEN** version.json 被更新为当前 CLI 版本，stdout 输出包含 `previousVersion: "0.0.1"`

#### Scenario: sync 保留用户代码
- **WHEN** 项目内 `src/App.tsx` 和 `tests/x.test.ts` 存在，执行 `localapp sync`
- **THEN** 这些文件的内容和 mtime 完全不变

#### Scenario: sync 保留用户自定义 skill
- **WHEN** 项目内 `.claude/skills/my-custom/` 存在，执行 `localapp sync`
- **THEN** `my-custom/` 目录完整保留

#### Scenario: --interactive 用户拒绝
- **WHEN** 执行 `localapp sync --interactive`，提示后输入 `n`
- **THEN** 输出 `{"success": false, "cancelled": true}`，退出码 0，不修改任何文件

#### Scenario: --off 关闭自动 sync
- **WHEN** 执行 `localapp sync --off`，再执行 `localapp sync --quiet`
- **THEN** 第二次输出 `{"success": true, "skipped": "autoSync disabled"}`，不修改任何文件

### Requirement: eject 命令端到端验证

e2e 测试 SHALL 验证 `eject` 命令的完整行为。

#### Scenario: eject 完整流程
- **WHEN** 执行 `localapp init test-app`，cd 进 test-app，执行 `localapp eject`，输入正确的项目名
- **THEN** `.localapp/runtime/` 不存在；`src/_localapp_runtime/` 存在且内容完整；`.claude/skills/localapp-*/` 改名为 `custom-localapp-*/`；`package.json` 中 `@localapp/sdk` 等引用指向 `./src/_localapp_runtime/sdk/...`；`dev-config.json` 包含 `"ejected": true`

#### Scenario: eject 后构建仍成功
- **WHEN** eject 完成后执行 `npm install && npm run build`
- **THEN** 构建成功，无 import 错误

#### Scenario: eject 后 sync 被拒绝
- **WHEN** eject 完成后执行 `localapp sync`
- **THEN** 输出错误 `{"error": "Project has been ejected..."}`，退出码 1

### Requirement: Schema CLI commands do not register application schemas

CLI SHALL NOT provide a normal workflow that creates, updates, or deletes application schemas directly in platform state once backend contract files are the schema source of truth.

#### Scenario: legacy schemas command is invoked
- **WHEN** user invokes a legacy `localapp schemas create`, `localapp schemas update`, or `localapp schemas delete` command
- **THEN** CLI MUST exit with a deprecation message that instructs the user to edit backend contract files and run validate/upload

#### Scenario: upload processes schema changes
- **WHEN** user edits backend resource schema files and runs `localapp upload`
- **THEN** CLI MUST treat those files as the source of application schema changes

### Requirement: Schema scaffold writes backend resource files

CLI schema/resource generation SHALL write files under the backend contract directory instead of the legacy `schemas/` directory.

#### Scenario: generate resource scaffold
- **WHEN** user invokes the supported resource scaffold command for `work_items`
- **THEN** CLI MUST create `backend/resources/work_items/schema.json`, `queries.json`, and `mutations.json` with `$schema` references

#### Scenario: legacy generate schema alias
- **WHEN** user invokes a retained `localapp generate schema work_items` compatibility alias
- **THEN** CLI MUST create backend resource contract files and MUST NOT create `schemas/work_items.json`

### Requirement: CLI help points to backend contracts

CLI help text and generated messages SHALL describe backend contract files as the supported way to manage application schemas.

#### Scenario: user reads generate help
- **WHEN** user runs CLI help for schema/resource generation
- **THEN** help text MUST mention backend resource contract files and MUST NOT mention `localapp schemas create`

### Requirement: upload rejects hosted backend actions
`localapp upload` SHALL reject hosted action source, manifest, and bundle files before uploading an app version.

#### Scenario: project contains backend actions
- **WHEN** 项目包含 `backend/actions/**`、`actions.manifest.json` 或 `actions.bundle.mjs`
- **AND** 用户执行 `localapp upload`
- **THEN** CLI MUST fail before creating the upload payload
- **AND** the error MUST point to named SQL, transaction mutation, or platform primitives

### Requirement: 本地应用包构建命令

CLI SHALL 提供 `localapp build --package [--output <file>]`，执行本地 contract、migration、测试、构建和包校验并生成 `.localapp`。该命令 SHALL 不要求 Server URL、API Key 或远端账号。

#### Scenario: 离线构建应用包
- **WHEN** 用户在未配置 Server 的有效项目执行 `localapp build --package`
- **THEN** CLI SHALL 成功生成 `.localapp` 并输出包路径、应用 ID、版本和摘要
- **AND** SHALL NOT 发出远端网络请求

### Requirement: 本地安装命令

CLI SHALL 提供 `localapp local install <package>`，通过 Desktop Local Runtime 的受控安装协议安装 `.localapp`，并输出安装结果。Desktop 未运行或包校验失败时 SHALL 返回明确错误且不修改应用状态。

#### Scenario: 安装并打开本地应用
- **WHEN** Desktop 正在运行且用户执行 `localapp local install app.localapp`
- **THEN** CLI SHALL 安装应用并输出本地应用标识、版本和可打开状态

### Requirement: CLI 命名 Server 参数

CLI 的 `login`、`check`、`upload` 和 `verify` 流程 SHALL 接受命名 profile。未指定 profile 时 SHALL 保持现有兼容默认目标行为。

#### Scenario: 指定 profile 上传
- **WHEN** 用户执行 `localapp upload --profile production --verify`
- **THEN** CLI SHALL 使用 `production` 完成整个远程发布流程
- **AND** 输出 SHALL 标识实际目标 profile 和 Server URL

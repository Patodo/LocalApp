## MODIFIED Requirements

### Requirement: login 命令

CLI SHALL 提供 `login` 命令，交互式收集 serverUrl 和 apiKey，保存到 `~/.localapp/work/config.json`。帮助文本 SHALL 使用中文描述命令用途。

#### Scenario: 首次配置
- **WHEN** 执行 `localapp login` 且 `~/.localapp/work/config.json` 不存在
- **THEN** 提示输入 serverUrl 和 apiKey，创建配置文件，输出 `{"success": true}`

#### Scenario: 更新配置
- **WHEN** 执行 `localapp login` 且配置文件已存在
- **THEN** 提示输入新的 serverUrl 和 apiKey（显示当前值作为默认），覆盖写入

#### Scenario: 帮助文本为中文
- **WHEN** 执行 `localapp login --help`
- **THEN** 显示中文命令描述，面向用户而非面向开发者

### Requirement: new 命令

CLI SHALL 提供 `new` 命令，读取 manifest.json 中的 name，在服务端创建页面。帮助文本 SHALL 使用中文描述命令用途，不暴露 manifest.json 等实现细节。

#### Scenario: 成功创建
- **WHEN** 执行 `localapp new` 且已配置 serverUrl 和 apiKey，manifest.json 包含合法 name
- **THEN** POST `/api/pages`（携带 name），服务端返回页面信息，输出 `{ "name": "...", "url": "..." }`

#### Scenario: 帮助文本为中文
- **WHEN** 执行 `localapp new --help`
- **THEN** 显示中文命令描述，不提及 manifest.json

### Requirement: upload 命令

CLI SHALL 提供 `upload <path>` 命令，从 manifest.json 读取 name，将文件上传到对应页面。帮助文本 SHALL 使用中文描述命令用途和参数含义。

#### Scenario: 成功上传
- **WHEN** 执行 `localapp upload ./dist`，manifest.json 存在且包含 name，目录包含文件
- **THEN** 递归读取目录文件，multipart POST 到 `/api/upload`（带 name 和 filepath 字段），输出 `{ "name", "url", "version" }`

#### Scenario: 帮助文本为中文
- **WHEN** 执行 `localapp upload --help`
- **THEN** path 参数描述为中文，不暴露 distDir 读取逻辑

### Requirement: pages 子命令

CLI SHALL 提供 `pages` 子命令组：`list`、`info [name]`、`delete [name]`。帮助文本 SHALL 使用中文描述各子命令用途。

#### Scenario: 列出页面
- **WHEN** 执行 `localapp pages list`
- **THEN** GET `/api/pages`，输出 JSON 页面列表

#### Scenario: 帮助文本为中文
- **WHEN** 执行 `localapp pages --help` 或 `localapp pages list --help`
- **THEN** 显示中文子命令描述

### Requirement: schemas 子命令

CLI SHALL 提供 `schemas` 子命令组：`create <name> --fields <json>`、`list`、`delete <name>`。帮助文本 SHALL 使用中文描述各子命令用途和参数含义。

#### Scenario: 创建 schema
- **WHEN** 执行 `localapp schemas create todos --fields '{"title":{"type":"string"}}'`
- **THEN** POST `/api/schemas`（带页面 name），输出 schema 信息含 endpoints

#### Scenario: 帮助文本为中文
- **WHEN** 执行 `localapp schemas --help` 或 `localapp schemas create --help`
- **THEN** 显示中文子命令描述，fields 参数说明为中文

### Requirement: update 命令

CLI SHALL 提供 `update` 子命令，从已配置的 Server 下载最新二进制并替换当前运行的 CLI。帮助文本 SHALL 使用中文描述命令用途。

#### Scenario: 成功更新
- **WHEN** 执行 `localapp update`，Server 返回版本信息且存在对应平台的二进制
- **THEN** 下载二进制到临时文件，移动替换当前可执行文件，输出 `{"success": true, "version": "<new_version>"}`

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

## ADDED Requirements

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

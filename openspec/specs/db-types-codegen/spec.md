# db-types-codegen Specification

## Purpose

定义从项目内离线 schema 工作库生成应用业务表 TypeScript 类型的输入、输出和隔离边界，使类型生成可离线复现且不会读取或修改任何 canonical Server 的运行时应用数据。

## Requirements

### Requirement: localapp db types 使用离线 schema 工作库

`localapp db types -o <file>` SHALL 从 `tmp/localapp-schema/schema.db` 反向生成 TypeScript interface。CLI SHALL 读取每个应用业务表的 `PRAGMA table_info`，排除 `_localapp_*` 内部表，并按 SQLite 类型生成字段类型。该命令 SHALL NOT 连接或修改开发 Server、远端 Server或已安装应用数据库。

#### Scenario: 生成 interface 文件

- **WHEN** 用户先运行 `localapp db migrate`，再运行 `localapp db types -o src/types.ts`
- **THEN** CLI SHALL 打开 `tmp/localapp-schema/schema.db`
- **AND** SHALL 为每个业务表生成导出的 TypeScript interface
- **AND** SHALL 输出生成数量和目标路径

#### Scenario: schema 工作库不存在

- **WHEN** 用户尚未运行 `localapp db migrate` 或 `localapp db reset`
- **THEN** `localapp db types` SHALL 返回明确错误
- **AND** SHALL 提示先创建离线 schema 工作库

#### Scenario: 没有业务表

- **WHEN** schema 工作库只包含 `_localapp_*` 内部表
- **THEN** CLI SHALL 创建只含说明注释的输出文件
- **AND** SHALL 提示没有业务表

### Requirement: 平台类型不从应用 schema 生成

`localapp db types` SHALL NOT 生成用户、群组、角色或其它 Server 平台类型。平台类型由 `@localapp/sdk-react` 随 Server 契约提供。

#### Scenario: 生成文件引用平台类型

- **WHEN** CLI 生成应用类型文件
- **THEN** 文件头 SHALL 提示从 `@localapp/sdk-react` 导入平台类型
- **AND** SHALL NOT 输出 `PlatformUser`、`PlatformGroup` 或 `PlatformRole` 的重复定义

### Requirement: SQLite 字段类型映射确定且保留数据库命名

生成器 SHALL 保留表名和列名的原始 snake_case，不做 PascalCase/camelCase 重命名。名称以 `is_` 开头的列 SHALL 生成为 `boolean`；BLOB affinity SHALL 生成为 `Uint8Array`；包含 INT、REAL、NUM、DOUBLE 或 FLOAT 的类型 SHALL 生成为 `number`；TEXT 和其它类型 SHALL 生成为 `string`。名称以 `_at` 结尾的列 SHALL 保持 `string` 并附加 ISO 8601 timestamp 注释。

#### Scenario: 映射混合 SQLite 列

- **WHEN** 表 `resume_files` 包含 `id INTEGER PRIMARY KEY`、`is_active INTEGER NOT NULL`、`content BLOB`、`score REAL`、`title TEXT` 和 `created_at TEXT`
- **THEN** 生成 interface 名 SHALL 为 `resume_files`
- **AND** 字段类型 SHALL 依次为 `number`、`boolean`、`Uint8Array`、`number`、`string` 和带 ISO 8601 注释的 `string`

### Requirement: nullability 决定 TypeScript 可选字段

PRIMARY KEY 或 SQLite `NOT NULL` 列 SHALL 生成必需属性；其它 nullable 列 SHALL 生成带 `?` 的可选属性。生成器 SHALL NOT 因默认值或命名约定改变该 nullability 规则。

#### Scenario: 生成可选和必需属性

- **WHEN** `id` 是 primary key、`title` 是 `NOT NULL`、`notes` 可为 NULL
- **THEN** `id` 和 `title` SHALL 是必需属性
- **AND** `notes` SHALL 生成为 `notes?: string`

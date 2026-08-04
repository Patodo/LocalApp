## Purpose

TBD - Schema 字段 defaultValue 处理。定义 insertRow 和 alterTableAddColumn 函数对 schema 字段 defaultValue 约束的应用程序逻辑。

## Requirements

### Requirement: insertRow 应用 defaultValue

`insertRow` 函数 SHALL 在插入记录时，对不在输入数据中的 schema 字段应用其 `defaultValue` 约束（如已定义）。

#### Scenario: 字段有 defaultValue 且不在输入数据中
- **WHEN** schema 定义了字段 `status` 含 `defaultValue: "open"`，且插入数据 `{ title: "test" }` 不包含 `status`
- **THEN** 插入的记录的 `status` 字段值为 `"open"`

#### Scenario: 字段有 defaultValue 但输入数据显式传值
- **WHEN** schema 定义了字段 `status` 含 `defaultValue: "open"`，且插入数据 `{ title: "test", status: "closed" }` 显式包含 `status`
- **THEN** 以输入数据为准，`status` 字段值为 `"closed"`

#### Scenario: 字段无 defaultValue 且不在输入数据中
- **WHEN** schema 字段 `description` 未定义 `defaultValue`，且插入数据不包含 `description`
- **THEN** 字段不加入 INSERT 列，保持现有行为（数据库存储 NULL）

#### Scenario: defaultValue 为布尔值 false
- **WHEN** schema 字段 `done` 含 `defaultValue: false`，且插入数据不包含 `done`
- **THEN** 插入的记录的 `done` 字段值为 `false`（而非 NULL）

#### Scenario: defaultValue 为数字 0
- **WHEN** schema 字段 `count` 含 `defaultValue: 0`，且插入数据不包含 `count`
- **THEN** 插入的记录的 `count` 字段值为 `0`（而非 NULL）

### Requirement: alterTableAddColumn 回填 defaultValue

`alterTableAddColumn` 函数 SHALL 在添加带 `defaultValue` 约束的字段时，将存量行的该字段值设为默认值。

#### Scenario: 新增字段含 defaultValue
- **WHEN** 对已有数据的表添加字段 `priority` 含 `defaultValue: "normal"`
- **THEN** 存量行的 `priority` 字段值为 `"normal"`，新增行也使用该默认值（通过 insertRow）

#### Scenario: 新增字段无 defaultValue
- **WHEN** 对已有数据的表添加字段 `note` 不含 `defaultValue`
- **THEN** 存量行的 `note` 字段值为 NULL，保持现有行为

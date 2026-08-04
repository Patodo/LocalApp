## ADDED Requirements

### Requirement: Backend root discovery
系统 SHALL 支持应用 manifest 通过 `backend.root` 声明应用后端契约目录，并将该目录作为 schema、policy、query、mutation 配置的默认发现入口。

#### Scenario: 使用默认 backend root
- **WHEN** manifest 声明 `"backend": { "root": "backend" }`
- **THEN** validate、upload、mini-server 和生产 server MUST 从 `backend/` 发现应用后端契约文件

#### Scenario: backend root 不存在
- **WHEN** manifest 声明的 backend root 不存在
- **THEN** validate MUST 失败并报告缺失目录

### Requirement: Backend include patterns
系统 SHALL 支持应用 manifest 通过 `backend.include` 声明精确文件匹配模式，并在存在 include 时按 include 收集后端契约文件。

#### Scenario: 使用 include patterns
- **WHEN** manifest 声明 `backend.include`
- **THEN** validate 和 upload MUST 只收集匹配 include 的 backend 契约文件

#### Scenario: include 未匹配文件
- **WHEN** include pattern 未匹配任何 backend 契约文件
- **THEN** validate MUST 失败并报告未匹配的 pattern

### Requirement: Backend JSON schema references
每个 backend JSON 配置文件 SHALL 包含 `$schema` 字段，指向平台发布的对应 JSON Schema URL 或 init-repo 内置的本地 schema 标识。

#### Scenario: 配置文件包含 schema 引用
- **WHEN** backend JSON 文件包含有效 `$schema`
- **THEN** validate MUST 使用对应 schema 校验该文件结构

#### Scenario: 配置文件缺少 schema 引用
- **WHEN** backend JSON 文件缺少 `$schema`
- **THEN** validate MUST 失败并提示补充 `$schema`

### Requirement: Backend contract packaging
上传应用时，CLI SHALL 将 backend 契约文件作为版本化应用元数据上传，并且不把未声明的 backend 外文件作为契约处理。

#### Scenario: 上传包含 backend 契约
- **WHEN** `localapp upload` 处理声明了 backend 的项目
- **THEN** 上传 payload MUST 包含已校验的 backend 契约文件和契约 manifest

#### Scenario: 未声明文件不进入契约
- **WHEN** 项目中存在未被 backend root 或 include 覆盖的 JSON 文件
- **THEN** CLI MUST NOT 将该文件作为 backend 契约上传

### Requirement: Backend contract consistency validation
系统 SHALL 在 validate 阶段检查 schema、SQL、migration 和权限配置之间的一致性。

#### Scenario: SQL 引用未知字段
- **WHEN** named SQL 引用 schema 中不存在的表或字段
- **THEN** validate MUST 失败并指出 SQL 名称和未知引用

#### Scenario: schema 与 migration 不一致
- **WHEN** schema 声明的表结构与 migration 可推导结构冲突
- **THEN** validate MUST 失败并提示 schema 与 migration 不一致

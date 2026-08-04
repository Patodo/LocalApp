## MODIFIED Requirements

### Requirement: 数据模型类型定义

shared 包 SHALL 定义 Page、Schema、SchemaField 等核心数据模型类型。Page 使用 name 作为标识符。

#### Scenario: Page 模型
- **WHEN** 定义 Page 类型
- **THEN** 包含 name（string，标识符）、userId、createdAt、updatedAt、currentVersion (number)、metadata (Record<string, unknown>)

#### Scenario: Schema 模型
- **WHEN** 定义 Schema 类型
- **THEN** 包含 name、pageName（所属页面标识）、fields（Record<string, SchemaField>）、createdAt、updatedAt

#### Scenario: SchemaField 类型
- **WHEN** 定义 SchemaField 类型
- **THEN** 支持 type 枚举（string、number、boolean、timestamp、auto_increment）和可选约束（required、unique、defaultValue）

### Requirement: API 类型定义

shared 包 SHALL 定义所有 HTTP API 的请求和响应类型，使用 name 替代 pageId。

#### Scenario: 页面创建请求类型
- **WHEN** 定义创建页面 API 请求类型
- **THEN** 包含 name (string，必填)

#### Scenario: 页面信息响应类型
- **WHEN** 定义页面信息响应类型
- **THEN** 包含 name、userId、createdAt、updatedAt、currentVersion (number)、schemas（schema 定义列表）

#### Scenario: Schema 创建请求类型
- **WHEN** 定义 schema 创建请求类型
- **THEN** 包含 pageName（string，页面标识）、name (string，资源名称)、fields（字段定义映射）

### Requirement: MCP Tool 类型定义

shared 包 SHALL 定义所有 MCP Tool 的参数和返回值类型，使用 name 替代 pageId。

#### Scenario: upload_page tool 类型
- **WHEN** 定义 upload_page 的参数类型
- **THEN** 包含 path (string, 本地目录路径) 和可选的 name (string, 页面标识)

#### Scenario: create_schema tool 类型
- **WHEN** 定义 create_schema 的参数类型
- **THEN** 包含 pageName (string)、name (string)、fields (Record<string, SchemaField>)

#### Scenario: list_pages tool 返回类型
- **WHEN** 定义 list_pages 的返回类型
- **THEN** 返回 Page 摘要列表，每项包含 name、currentVersion、createdAt、updatedAt

## REMOVED Requirements

### Requirement: Version 模型
**Reason**: Version 模型不涉及本次变更，保持不变（仅 Page/Schema 模型的标识字段变更）
**Migration**: Version 类型无变化

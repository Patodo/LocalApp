## MODIFIED Requirements

### Requirement: 数据模型类型定义

类型定义 SHALL 位于 `packages/server/src/types/models.ts`，定义 Page、Schema、SchemaField、AccessLevel、PageAccess、RouteAccess、ManifestDb、ManifestDbAccess、DbMode 等核心数据模型类型。Page 使用 name 作为标识符。

#### Scenario: Page 模型
- **WHEN** 定义 Page 类型
- **THEN** 包含 name（string，标识符）、userId、createdAt、updatedAt、currentVersion (number)、metadata (Record<string, unknown>)

#### Scenario: Schema 模型
- **WHEN** 定义 Schema 类型
- **THEN** 包含 name、pageName（所属页面标识）、fields（Record<string, SchemaField>）、createdAt、updatedAt

#### Scenario: SchemaField 类型
- **WHEN** 定义 SchemaField 类型
- **THEN** 支持 type 枚举（string、number、boolean、timestamp、auto_increment）和可选约束（required、unique、defaultValue）

#### Scenario: 访问控制类型
- **WHEN** 定义 AccessLevel 类型
- **THEN** 支持 "public"、"authenticated"、"owner"、"acl" 四个级别

#### Scenario: DB 模式类型
- **WHEN** 定义 ManifestDb 类型
- **THEN** 包含 mode（"crud" | "sql"）、可选 sqlAccess（AccessLevel）、可选 defaultAccess（ManifestDbAccess）

### Requirement: API 类型定义

API 请求响应类型 SHALL 位于 `packages/server/src/types/api.ts`，定义所有 HTTP API 的请求和响应类型，使用 name 替代 pageId。

#### Scenario: 页面信息响应类型
- **WHEN** 定义页面信息响应类型
- **THEN** 包含 name、userId、createdAt、updatedAt、currentVersion (number)、schemas（schema 定义列表）

#### Scenario: Schema 创建请求类型
- **WHEN** 定义 schema 创建请求类型
- **THEN** 包含 pageName（string，页面标识）、name (string，资源名称)、fields（字段定义映射）

### Requirement: MCP Tool 类型定义

MCP Tool 参数和返回值类型 SHALL 位于 `packages/server/src/types/mcp.ts`，使用 name 替代 pageId。

#### Scenario: upload_page tool 类型
- **WHEN** 定义 upload_page 的参数类型
- **THEN** 包含 path (string, 本地目录路径) 和可选的 name (string, 页面标识)

#### Scenario: create_schema tool 类型
- **WHEN** 定义 create_schema 的参数类型
- **THEN** 包含 pageName (string)、name (string)、fields (Record<string, SchemaField>)

#### Scenario: list_pages tool 返回类型
- **WHEN** 定义 list_pages 的返回类型
- **THEN** 返回 Page 摘要列表，每项包含 name、currentVersion、createdAt、updatedAt

### Requirement: 类型导出

类型文件 SHALL 通过相对路径直接引用（如 `import type { DataSchema } from "../types/models.js"`），不使用 barrel 文件中转。MUST 不再存在独立的 `@localapp/shared` 包。

#### Scenario: server 内部类型引用
- **WHEN** 在 server 路由文件中 `import type { DataSchema } from "../types/models.js"`
- **THEN** TypeScript 编译器正确解析类型，无需 workspace 依赖

#### Scenario: 不存在 shared 包
- **WHEN** 查看 `packages/` 目录
- **THEN** 不存在 `packages/shared/` 目录

## REMOVED Requirements

### Requirement: 类型 barrel 导出
**Reason**: 独立 shared 包已移除，barrel 导出不再需要。server 内部直接使用相对路径引用类型文件。
**Migration**: 所有 `import ... from "@localapp/shared"` 替换为 `import ... from "../types/{file}.js"`

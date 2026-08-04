## ADDED Requirements

### Requirement: API 类型定义

shared 包 SHALL 定义所有 HTTP API 的请求和响应类型，涵盖页面管理和 schema 管理接口。

#### Scenario: 页面上传请求类型
- **WHEN** 定义 upload API 请求类型
- **THEN** 包含 userId (string)、pageId (string, 可选)、files（文件列表，每项包含 filename 和 content/路径）

#### Scenario: 页面信息响应类型
- **WHEN** 定义页面信息响应类型
- **THEN** 包含 pageId、userId、createdAt、updatedAt、currentVersion (number)、versionCount (number)、schemas（schema 定义列表）

#### Scenario: Schema 创建请求类型
- **WHEN** 定义 schema 创建请求类型
- **THEN** 包含 userId、pageId、name (资源名称)、fields（字段定义映射，每个字段包含 type 和 constraints）

### Requirement: 数据模型类型定义

shared 包 SHALL 定义 Page、Version、Schema、SchemaField 等核心数据模型类型。

#### Scenario: Page 模型
- **WHEN** 定义 Page 类型
- **THEN** 包含 id、userId、createdAt、updatedAt、currentVersion、metadata (Record<string, unknown>)

#### Scenario: Version 模型
- **WHEN** 定义 Version 类型
- **THEN** 包含 version (number)、createdAt、fileCount (number)、totalSize (number)

#### Scenario: Schema 模型
- **WHEN** 定义 Schema 类型
- **THEN** 包含 name、pageId、fields（Record<string, SchemaField>）、createdAt、updatedAt

#### Scenario: SchemaField 类型
- **WHEN** 定义 SchemaField 类型
- **THEN** 支持 type 枚举（string、number、boolean、timestamp、auto_increment）和可选约束（required、unique、defaultValue）

### Requirement: MCP Tool 类型定义

shared 包 SHALL 定义所有 MCP Tool 的参数和返回值类型。

#### Scenario: upload_page tool 类型
- **WHEN** 定义 upload_page 的参数类型
- **THEN** 包含 path (string, 本地目录路径) 和可选的 pageId (string)

#### Scenario: create_schema tool 类型
- **WHEN** 定义 create_schema 的参数类型
- **THEN** 包含 pageId (string)、name (string)、fields (Record<string, SchemaField>)

#### Scenario: list_pages tool 返回类型
- **WHEN** 定义 list_pages 的返回类型
- **THEN** 返回 Page 摘要列表，每项包含 pageId、currentVersion、createdAt、updatedAt

### Requirement: 类型 barrel 导出

shared/src/index.ts MUST 导出所有类型定义，其他子包通过 `import { ... } from '@localapp/shared'` 使用。

#### Scenario: 跨包类型引用
- **WHEN** 在 server 子包中 `import { Page, UploadRequest } from '@localapp/shared'`
- **THEN** TypeScript 编译器正确解析类型，IDE 提供类型提示和跳转

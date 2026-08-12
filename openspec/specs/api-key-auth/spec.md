## Purpose

API Key 鉴权与 CLI 版本强制更新机制。通过 X-API-Key header 验证用户身份，通过 X-CLI-Version header 确保客户端版本兼容。

## Requirements

### Requirement: API Key 验证

所有管理接口 MUST 要求请求携带 `X-API-Key` header。服务器 SHALL 使用 `meta.sqlite` 中保存的摘要验证新签发 Key，并 SHALL 在迁移期兼容匹配升级前已存在的明文 Key。验证通过后 SHALL 获取对应 userId 并执行 CLI 版本校验。API Key 认证与 session cookie 认证 SHALL 并行存在。

#### Scenario: 有效摘要 API Key 请求
- **WHEN** 请求携带新签发的有效 API Key
- **THEN** Server 对候选值计算摘要并匹配对应 userId
- **AND** 请求通过验证

#### Scenario: 升级前的有效明文 API Key
- **WHEN** 数据库包含升级前的明文 API Key 且请求携带该 Key
- **THEN** 请求在兼容路径通过验证

#### Scenario: 缺少 API Key
- **WHEN** 请求未携带 `X-API-Key` header
- **THEN** 返回 HTTP 401，响应体包含 `{ success: false, error: "API key required" }`

#### Scenario: 无效 API Key
- **WHEN** 请求携带无法匹配明文或摘要记录的 API Key
- **THEN** 返回 HTTP 401，响应体包含 `{ success: false, error: "Invalid API key" }`

### Requirement: CLI 版本校验

Auth hook 在 API Key 验证通过后 SHALL 检查 `X-CLI-Version` header。若 header 缺失或版本号低于 `MIN_CLI_VERSION` 环境变量指定的值，MUST 返回 HTTP 403。版本错误 SHALL 提示通过 npm 更新 `localapp` 包；Server SHALL NOT 提供独立 CLI 二进制下载端点。

#### Scenario: 版本满足最低要求
- **WHEN** 请求携带 `X-CLI-Version: 0.2.0` 且 `MIN_CLI_VERSION=0.1.0`
- **THEN** 版本检查通过，请求正常处理

#### Scenario: 版本低于最低要求
- **WHEN** 请求携带 `X-CLI-Version: 0.1.0` 且 `MIN_CLI_VERSION=0.2.0`
- **THEN** 返回 HTTP 403，响应体包含错误信息提示执行 `npm update --global localapp`

#### Scenario: 缺失版本 header
- **WHEN** 请求未携带 `X-CLI-Version` header 且 `MIN_CLI_VERSION` 已设置
- **THEN** 返回 HTTP 403，响应体包含 `"CLI version unknown"` 提示更新

#### Scenario: 未配置最低版本
- **WHEN** `MIN_CLI_VERSION` 环境变量未设置或为空字符串
- **THEN** 跳过版本检查，所有请求放行

### Requirement: API Key 存储初始化

服务器启动时 MUST 确保 `meta.sqlite` 和 `api_keys` 表存在。若不存在 SHALL 自动创建。

#### Scenario: 首次启动
- **WHEN** `meta.sqlite` 文件不存在
- **THEN** 创建文件并初始化 `api_keys` 表，服务器正常启动

#### Scenario: 已有数据库
- **WHEN** `meta.sqlite` 已存在且表结构正确
- **THEN** 直接使用，不重新创建

### Requirement: API Key 管理接口

系统 SHALL 提供需认证的 API Key 管理接口。`POST /api/keys` MUST 只在创建响应中返回完整 Key，并以摘要存储；`GET /api/keys` MUST 只返回掩码标识和创建时间，不得恢复或返回完整 Key。

#### Scenario: 创建新 API Key
- **WHEN** 已认证用户发送 `POST /api/keys`
- **THEN** 生成随机 API Key，以摘要存入 meta.sqlite
- **AND** 仅本次响应返回完整 Key 与 userId

#### Scenario: 列出 API Keys
- **WHEN** 已认证用户发送 `GET /api/keys`
- **THEN** 返回当前用户的 Key 掩码和 `createdAt`
- **AND** 响应不包含任一完整 Key

#### Scenario: Session 认证创建 API Key
- **WHEN** 携带有效 session cookie 发送 `POST /api/keys` 且 body 中无 userId
- **THEN** 为当前用户创建摘要存储的 Key
- **AND** 仅本次响应返回完整 Key

### Requirement: 注册时生成 API Key

系统不再通过公开或 CLI 自动注册生成 API Key。管理员供应用户时 SHALL 原子生成初始 API Key，以摘要存储并只在供应成功响应中返回一次明文。

#### Scenario: 管理员供应返回初始 API Key
- **WHEN** 管理员成功创建用户
- **THEN** 响应包含一次性初始 API Key
- **AND** 数据库只保存该 Key 的摘要

#### Scenario: 客户端自动注册不生成 API Key
- **WHEN** 客户端请求已移除的 CLI 自动注册接口
- **THEN** 返回 HTTP 410
- **AND** 不创建 API Key

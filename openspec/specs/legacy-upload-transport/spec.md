# legacy-upload-transport Specification

## Purpose

记录仍由 Server 保留的 `/api/upload` multipart 兼容传输边界；新 CLI 和正式发布流程使用 `.localapp` 包安装，该接口不得成为第二套权威安装实现。

## Requirements

### Requirement: legacy upload 只作为兼容传输

Server MAY 保留经过认证的 `POST /api/upload` 以接收旧 multipart 客户端的 dist、manifest、migrations 和 backend contract。Server SHALL 把这些字段规范化为临时 `.localapp` 包并调用正式应用包安装器；loose 文件 SHALL NOT 被直接复制为权威活动版本。新 CLI SHALL NOT 暴露 `localapp upload`。

#### Scenario: 兼容上传成功

- **WHEN** 已认证所有者向已有应用提交有效 multipart 上传
- **THEN** Server SHALL 生成并校验临时应用包
- **AND** SHALL 通过正式安装器原子创建应用版本
- **AND** 完成后 SHALL 清理临时 staging 包

### Requirement: legacy upload 保留现有容量限制

单个 multipart 文件和前端文件集合 SHALL 不得超过 50MB；安装后用户既有存储量加本次前端文件大小 SHALL 不得超过 500MB。超限请求 SHALL 返回 HTTP 413，并且不得改变活动版本、数据库或现有文件。

#### Scenario: 请求超过 50MB

- **WHEN** 上传文件或前端文件集合超过 50MB
- **THEN** Server SHALL 返回 413
- **AND** SHALL NOT 安装部分内容

#### Scenario: 用户超过 500MB 配额

- **WHEN** 本次上传将使所有者存储使用量超过 500MB
- **THEN** Server SHALL 返回 413 和明确配额错误
- **AND** 现有应用 SHALL 保持不变

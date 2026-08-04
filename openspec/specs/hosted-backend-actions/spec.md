# hosted-backend-actions Specification

## Purpose

This capability records the stable behavior of the legacy hosted action API surface after LocalApp adopted a named SQL-first backend model.

## Requirements

### Requirement: Hosted action endpoint disabled
系统 SHALL 保留 `POST /serve/:owner/:app/api/actions/:name` 作为 legacy 诊断入口，但 SHALL NOT 执行应用上传的 hosted backend action。

#### Scenario: 调用 action endpoint
- **WHEN** 前端或旧 SDK 调用 action endpoint
- **THEN** server MUST 返回 `hosted_actions_disabled` 类错误
- **AND** server MUST NOT 执行任何应用 action 代码
- **AND** server MUST NOT 读取 action manifest、bundle 或创建 worker

### Requirement: Hosted action files are unsupported backend contract files
应用 SHALL NOT upload `backend/actions/**` source files, `actions.manifest.json`, or `actions.bundle.mjs` as stable backend contract files.

#### Scenario: 上传包含 hosted action 文件
- **WHEN** CLI validate、CLI upload 或 server upload 发现 hosted action source、manifest 或 bundle
- **THEN** 操作 MUST fail before creating a new app version
- **AND** error MUST recommend named SQL, transaction mutation, or platform primitives

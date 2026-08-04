## ADDED Requirements

### Requirement: Backend actions discovery
系统 SHALL 支持在 backend 契约目录中发现 backend action 源码，并将其纳入 backend contract 的校验与打包流程。

#### Scenario: 默认 actions 目录
- **WHEN** manifest 声明 `"backend": { "root": "backend" }`
- **AND** 项目包含 `backend/actions/leave.ts`
- **THEN** validate MUST 将该文件识别为 backend action 源码

#### Scenario: include patterns 覆盖 actions
- **WHEN** manifest 声明 `backend.include`
- **THEN** 只有被 include 覆盖的 action 源码或 action manifest MUST 进入 backend contract

### Requirement: Action manifest packaging
上传应用时，CLI SHALL 将构建后的 action bundle 和 action manifest 作为当前应用版本的一部分上传，server SHALL 随版本保存。

#### Scenario: 上传包含 action manifest
- **WHEN** 应用包含 backend actions 且构建成功
- **THEN** 上传 payload MUST 包含 `actions.manifest.json`
- **AND** server MUST 将其保存到当前版本目录

#### Scenario: 上传包含 action bundle
- **WHEN** 应用包含 backend actions 且构建成功
- **THEN** 上传 payload MUST 包含 action bundle 文件
- **AND** server MUST 只从当前版本目录加载该 bundle

### Requirement: Action contract validation
validate 阶段 SHALL 校验 action manifest 与 backend contract 的一致性，包括 action 名称唯一性、输入 schema 可序列化、访问等级合法和引用的 named SQL 存在。

#### Scenario: action 名称重复
- **WHEN** 两个 action 声明相同名称
- **THEN** validate MUST 失败并指出重复名称

#### Scenario: action 引用未知 named SQL
- **WHEN** action manifest 声明依赖 `leave.approve` mutation 但 backend contract 中不存在该 named SQL
- **THEN** validate MUST 失败并指出缺失的 named SQL

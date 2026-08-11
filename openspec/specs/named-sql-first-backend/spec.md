# named-sql-first-backend Specification

## Purpose

LocalApp's stable application backend model is declarative backend contract files executed by the platform. Hosted JavaScript backend execution is not a default stable capability.

## Requirements

### Requirement: Named SQL-first backend model
LocalApp SHALL define the stable application backend as declarative backend contract files executed by the platform. Stable backend contract capabilities SHALL include schemas, migrations, registered named queries, registered named mutations, and registered transaction mutations.

#### Scenario: 应用声明稳定后端契约
- **WHEN** 应用通过 backend contract 声明 schema、migration、named query 和 named mutation
- **THEN** CLI validate、package build、Server install 和 application serve MUST treat those declarations as the stable backend path
- **AND** 平台 MUST NOT require application-packaged JavaScript backend runtime for ordinary business data access

#### Scenario: 复杂业务应用使用 named SQL-first
- **WHEN** 应用需要实现列表、详情、筛选、统计、导入预览、协作状态或阶段工作量等 team-workload 级复杂功能
- **THEN** 平台 MUST direct reads to bounded named SQL, SQL aggregation, JOINs, pagination, or frontend local assembly
- **AND** 平台 MUST direct database writes to named mutation, transaction mutation, or platform-provided primitives

### Requirement: Custom hosted JavaScript backend is not a default stable capability
LocalApp SHALL NOT expose application-packaged hosted JavaScript backend actions as a default stable platform capability.

#### Scenario: 新应用尝试使用 hosted JS backend
- **WHEN** 新应用包含 hosted action manifest、action bundle 或 action source
- **THEN** validate or package build MUST fail with a clear unsupported capability error
- **AND** the error MUST tell the developer to use named SQL, transaction mutation, or a platform primitive

#### Scenario: 文档描述 backend 能力
- **WHEN** 开发者阅读 LocalApp backend 文档、init 模板说明或应用协作 skill
- **THEN** 文档 MUST describe backend as declarative backend contract first
- **AND** 文档 MUST NOT describe hosted action as the default way to write application backend logic

### Requirement: Stability gate for future hosted runtime
Any future reintroduction of hosted JavaScript backend execution SHALL require a separate stability gate before being described as stable.

#### Scenario: 平台重新开放 hosted runtime
- **WHEN** LocalApp proposes to re-enable hosted JavaScript backend execution
- **THEN** the proposal MUST include isolation, database safety, failure containment, observability, and stress/e2e acceptance criteria
- **AND** the runtime MUST prove that one failed action cannot corrupt or disable later named SQL requests

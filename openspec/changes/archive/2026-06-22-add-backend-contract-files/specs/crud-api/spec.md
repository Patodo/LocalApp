## ADDED Requirements

### Requirement: Application CRUD can be backed by backend contract
现有资源 CRUD SDK 方法 SHALL be able to resolve to system named query / mutation definitions from the application backend contract.

#### Scenario: backend contract provides system list query
- **WHEN** a resource has a registered `$resource.list` query
- **THEN** `client.list(resource)` MUST be able to call the corresponding named query endpoint

#### Scenario: backend contract missing system query
- **WHEN** a resource does not provide the corresponding system named endpoint during compatibility phase
- **THEN** SDK/runtime MAY fall back to the existing platform CRUD endpoint

### Requirement: System CRUD contract compatibility
系统 named CRUD definitions SHALL preserve the response shape expected by existing SDK resource methods.

#### Scenario: list response shape
- **WHEN** `client.list(resource)` is served by a system named query
- **THEN** response MUST include rows and pagination data compatible with existing list consumers

#### Scenario: count response shape
- **WHEN** `client.count(resource)` is served by a system named query
- **THEN** response MUST include `{ count }` compatible with existing count consumers

## ADDED Requirements

### Requirement: Schema files live in backend contract
应用级数据 schema SHALL be defined in backend contract files instead of being maintained as hidden platform-only application schema state.

#### Scenario: schema file discovered
- **WHEN** `backend/resources/work_items/schema.json` defines a resource schema
- **THEN** validate MUST register `work_items` as an application resource schema

#### Scenario: duplicate schema names
- **WHEN** multiple backend schema files define the same resource name
- **THEN** validate MUST fail with a duplicate schema error

### Requirement: Schema JSON uses published schema
应用级 schema JSON files SHALL include a `$schema` reference to the platform resource schema JSON Schema. Published backend JSON Schemas SHALL use JSON Schema draft 2020-12 as their dialect.

#### Scenario: schema file has valid schema reference
- **WHEN** a resource schema JSON contains a valid `$schema`
- **THEN** editor tooling and CLI validate MUST be able to validate its structure against the published schema

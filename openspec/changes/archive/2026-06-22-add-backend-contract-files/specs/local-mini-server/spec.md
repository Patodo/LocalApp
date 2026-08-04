## ADDED Requirements

### Requirement: Mini-server uses backend contract executor
本地 mini-server SHALL read the same backend contract files as production and SHALL use shared server-core logic for named SQL validation and execution.

#### Scenario: local query matches production
- **WHEN** a registered named query is called in `localapp dev`
- **THEN** mini-server MUST apply the same params validation, access checks, system variables and SQL safety rules as production server

#### Scenario: backend contract changes locally
- **WHEN** developer edits backend contract files during local development
- **THEN** mini-server MUST reload or re-read the updated contract consistently with existing dev refresh behavior

### Requirement: Mini-server rejects frontend SQL for named endpoints
本地 mini-server SHALL reject attempts to submit SQL text to named query / mutation endpoints.

#### Scenario: local request includes sql field
- **WHEN** frontend code calls local named SQL endpoint with a `sql` field
- **THEN** mini-server MUST NOT execute that frontend-supplied SQL

## ADDED Requirements

### Requirement: Hosted action is a constrained business command layer

Hosted backend actions SHALL be constrained to server-side business orchestration. The platform MUST NOT treat action handlers as the default mechanism for ordinary list, detail, filter, report, or full read-model queries.

#### Scenario: command action handles trusted write orchestration
- **WHEN** an action performs approval, state transition, cascade delete, permission-sensitive write, notification orchestration, or synchronous server-side validation
- **THEN** platform MUST allow the action when its manifest, access control, declared SQL uses, and runtime budgets are valid

#### Scenario: action tries to return full read model
- **WHEN** an action is declared or detected as loading unpaginated multi-table read data for a full list response
- **THEN** validate, upload, or runtime MUST reject it with a stable resource or contract error
- **AND** the error MUST direct the application to bounded named SQL, pagination, aggregation, filtering, or frontend assembly

### Requirement: Action ctx exposes only declared named SQL

The trusted action context SHALL enforce the action manifest allowlist. `ctx.query` and `ctx.mutate` MUST NOT execute arbitrary registered named SQL merely because it exists in the app backend contract.

#### Scenario: declared query call succeeds
- **WHEN** an action declares `uses.queries: ["tasks.page"]`
- **AND** the handler calls `ctx.query("tasks.page", params)`
- **THEN** runtime MUST allow the call if access control and query result bounds pass

#### Scenario: undeclared query call fails
- **WHEN** an action does not declare `tasks.all` in `uses.queries`
- **AND** the handler calls `ctx.query("tasks.all", params)`
- **THEN** runtime MUST return an action contract error
- **AND** `tasks.all` MUST NOT execute

#### Scenario: SDK generated ctx hides undeclared calls
- **WHEN** the backend SDK or template generates action helper types from manifest
- **THEN** undeclared query and mutation names SHOULD be absent from the typed ctx helper surface
- **AND** runtime allowlist validation MUST remain authoritative

### Requirement: Action query usage requires bounded named query

Action handlers SHALL call named queries only when those queries declare and satisfy bounded result metadata.

#### Scenario: action calls page query
- **WHEN** an action calls a declared query with `result.mode` equal to `page`
- **THEN** runtime MUST enforce the query row and byte budget before transferring the result to the worker

#### Scenario: action calls unbounded query
- **WHEN** an action calls a query that has no result bounds or exceeds its declared bounds
- **THEN** runtime MUST reject the call before the worker receives the query result
- **AND** the error code MUST be stable for SDK and developer tooling

## ADDED Requirements

### Requirement: Action contract declares execution intent and SQL uses

Backend action manifests SHALL declare each action's execution intent and named SQL dependencies. The default action type SHALL be `command`. The platform MUST treat `uses.queries` and `uses.mutations` as the complete allowlist for SQL calls made by that action.

#### Scenario: command action declares mutations
- **WHEN** an action manifest contains a command action with `uses.mutations`
- **THEN** validate and upload MUST accept the action only if every referenced mutation exists in the backend contract
- **AND** runtime MUST allow the action to call only those declared mutations

#### Scenario: action calls undeclared named SQL
- **WHEN** an action attempts to call `ctx.query` or `ctx.mutate` for a name not declared in that action's `uses`
- **THEN** runtime MUST reject the call with a stable action contract error
- **AND** the named SQL MUST NOT execute

#### Scenario: action references unknown named SQL
- **WHEN** action manifest `uses` references a query or mutation missing from backend contract files
- **THEN** validate and upload MUST fail and identify the action name and missing SQL name

### Requirement: Query result contract for bounded reads

Backend named query entries SHALL support a `result` declaration describing the expected result shape and platform budget. Queries referenced by actions MUST declare a bounded result shape.

#### Scenario: page query declares pagination
- **WHEN** a named query declares `result.mode` as `page`
- **THEN** the query contract MUST declare a numeric `limit` parameter or equivalent bounded pagination parameter
- **AND** validate MUST enforce that the effective max rows does not exceed the platform limit

#### Scenario: action references query without result declaration
- **WHEN** an action `uses.queries` references a named query without a `result` declaration
- **THEN** validate and upload MUST reject the backend contract
- **AND** the error MUST tell the developer to add pagination, single-row, aggregate, or explicit bounded result metadata

#### Scenario: aggregate query declares budget
- **WHEN** a named query declares `result.mode` as `aggregate`
- **THEN** validate MUST allow aggregate reads that declare max rows and max bytes within platform limits

### Requirement: Upload rejects unbounded action read models

CLI validate, CLI upload, and server upload SHALL reject action/query combinations that can load unbounded read models into action workers.

#### Scenario: action references unpaginated list query
- **WHEN** an action references a query whose SQL is a list-style `SELECT` without a `LIMIT` or bounded result metadata
- **THEN** upload MUST fail before creating a new app version
- **AND** the response MUST recommend paginated named SQL, SQL aggregation, filtering, or frontend assembly

#### Scenario: direct named query remains allowed with runtime budget
- **WHEN** a named query is not referenced by any action
- **THEN** upload MAY accept it if it passes named SQL safety validation
- **AND** runtime MUST still enforce named SQL result budgets when it is executed

#### Scenario: server upload revalidates backend contract
- **WHEN** a client uploads backend files using an old CLI or handcrafted request
- **THEN** server upload MUST apply the same action/read-boundary validation before saving the version
- **AND** invalid backend files MUST be rejected without changing current app version

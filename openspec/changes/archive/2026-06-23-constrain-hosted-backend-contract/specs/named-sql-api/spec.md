## ADDED Requirements

### Requirement: Named query result shapes

Named query contract entries SHALL support result shape metadata used by validate, upload, runtime budgets, SDK guidance, and action allowlist enforcement.

#### Scenario: page result shape
- **WHEN** a named query declares `result.mode` as `page`
- **THEN** the contract MUST define a bounded page size through params or metadata
- **AND** runtime MUST enforce the smaller of request limit, contract max rows, and platform max rows

#### Scenario: single result shape
- **WHEN** a named query declares `result.mode` as `single`
- **THEN** runtime MUST reject results containing more than one row

#### Scenario: aggregate result shape
- **WHEN** a named query declares `result.mode` as `aggregate`
- **THEN** runtime MUST enforce declared rows and bytes budgets
- **AND** upload MUST allow the query to be referenced by actions only if those budgets fit platform limits

### Requirement: Named SQL query execution enforces budgets during row materialization

Named SQL query execution SHALL enforce row and byte budgets while reading SQL results, before the full result set is materialized as JavaScript objects.

#### Scenario: query exceeds max rows while stepping
- **WHEN** a query produces more rows than its effective budget allows
- **THEN** execution MUST stop reading additional rows
- **AND** server MUST return `named_sql_result_too_large` or equivalent stable error

#### Scenario: query exceeds max bytes while stepping
- **WHEN** the estimated JSON bytes of accumulated rows exceeds the effective byte budget
- **THEN** execution MUST stop reading additional rows
- **AND** server MUST return a clear result-too-large error without exposing sql.js internals

#### Scenario: small bounded query succeeds
- **WHEN** a query result stays within row and byte budgets
- **THEN** server MUST return rows in the existing named SQL response shape

### Requirement: Named SQL remains the default read model path

Applications SHALL use bounded named SQL rather than hosted actions for ordinary read models such as lists, detail views, filters, search, summaries, and reports.

#### Scenario: application needs list page
- **WHEN** an application needs a list screen
- **THEN** the platform contract MUST support expressing the read model as paginated named SQL
- **AND** action runtime MUST NOT be required for that list screen

#### Scenario: application needs count or summary
- **WHEN** an application needs counts, grouped totals, or lightweight summaries
- **THEN** the platform contract MUST support expressing the computation as aggregate named SQL
- **AND** the result MUST be protected by named SQL budgets

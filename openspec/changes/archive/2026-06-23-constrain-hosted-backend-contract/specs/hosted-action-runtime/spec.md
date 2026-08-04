## ADDED Requirements

### Requirement: Action RPC result budgets enforced before worker transfer

The hosted action runtime SHALL enforce SQL RPC result budgets before posting query or mutation results from the server thread to the action worker.

#### Scenario: ctx query exceeds row budget
- **WHEN** an action `ctx.query` result exceeds the allowed row count
- **THEN** runtime MUST reject the RPC before `postMessage` transfers rows to the worker
- **AND** the action MUST receive a stable SQL result budget error

#### Scenario: ctx query exceeds byte budget
- **WHEN** an action `ctx.query` result exceeds the allowed byte budget
- **THEN** runtime MUST reject the RPC before worker transfer
- **AND** diagnostics MUST include action name, SQL name, rows, bytes, and configured budget

### Requirement: Worker resource failures remain isolated and recoverable

Worker resource failures, structured clone failures, and sql.js/WASM errors observed during action execution SHALL affect only the current action call and MUST NOT require restarting the platform server to recover.

#### Scenario: worker structured clone fails
- **WHEN** action result or RPC payload cannot be cloned
- **THEN** runtime MUST return an action resource error
- **AND** the worker MUST be discarded
- **AND** later action calls MUST use a healthy worker

#### Scenario: database runtime error occurs during action RPC
- **WHEN** a WASM runtime error occurs while executing an action SQL RPC
- **THEN** runtime MUST return a database runtime error with stable code
- **AND** the affected database connection MUST be discarded or reopened before later requests use it

### Requirement: Action diagnostics identify contract and budget failures

Hosted action diagnostics SHALL distinguish contract violations, SQL result budget failures, action result budget failures, queue failures, timeout failures, and worker resource failures.

#### Scenario: action violates SQL allowlist
- **WHEN** action calls undeclared named SQL
- **THEN** diagnostics MUST record the action name, attempted SQL name, and action contract error code

#### Scenario: action SQL budget fails
- **WHEN** action SQL RPC exceeds row or byte limits
- **THEN** diagnostics MUST record row count, byte estimate, budget, SQL name, and app key

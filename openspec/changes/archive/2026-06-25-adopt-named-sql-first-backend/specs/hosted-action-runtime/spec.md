## REMOVED Requirements

### Requirement: Worker-isolated action execution
**Reason**: The platform is no longer required to execute application-uploaded hosted backend action code.
**Migration**: Use named SQL-first backend contract capabilities.

### Requirement: Action timeout and termination
**Reason**: Hosted action workers are no longer created for stable application requests.
**Migration**: Named SQL and transaction mutation requests retain their own queue and timeout handling.

### Requirement: Per-app action concurrency control
**Reason**: Action worker scheduling is not part of the stable runtime.
**Migration**: Use per-database named SQL queues and platform request limits.

### Requirement: Action RPC database backpressure
**Reason**: Action RPC is removed from the stable request path.
**Migration**: Named SQL requests directly use the per-db execution queue.

### Requirement: Action resource and runtime error classification
**Reason**: Runtime resource failures are avoided by not executing hosted action workers.
**Migration**: The action endpoint returns a stable disabled capability error.

### Requirement: Database runtime errors during action RPC
**Reason**: Action SQL RPC is removed from the stable request path.
**Migration**: Database runtime errors are handled by named SQL execution diagnostics.

### Requirement: Action execution observability
**Reason**: Hosted action execution diagnostics are not required when execution is disabled.
**Migration**: Named SQL and transaction mutation diagnostics remain required.

### Requirement: Developer guidance for action scope
**Reason**: Guidance should no longer teach scoped hosted action usage.
**Migration**: Guidance must teach named SQL-first backend contracts.

### Requirement: Action resource budgets
**Reason**: The hosted action runtime no longer runs user action code.
**Migration**: Named SQL result budgets and transaction mutation limits remain active.

### Requirement: Platform-bounded action worker scheduling
**Reason**: Worker scheduling is not needed when action workers are not created.
**Migration**: Future hosted runtime proposals must define a separate stability gate.

### Requirement: Recyclable hot action workers
**Reason**: Hot action workers are outside the named SQL-first platform scope.
**Migration**: No migration; do not reuse hosted workers in the stable runtime.

### Requirement: Action runtime capacity diagnostics
**Reason**: Action runtime capacity diagnostics are replaced by disabled endpoint diagnostics.
**Migration**: Log disabled action endpoint calls as unsupported capability requests if needed.

### Requirement: Action RPC result budgets enforced before worker transfer
**Reason**: There is no action worker transfer in the stable runtime.
**Migration**: Enforce named SQL result budgets during direct row materialization.

### Requirement: Worker resource failures remain isolated and recoverable
**Reason**: The stable platform avoids worker resource failure by not running hosted workers.
**Migration**: Any future hosted runtime must reintroduce this requirement under a new stability-gated change.

### Requirement: Action diagnostics identify contract and budget failures
**Reason**: Action contract and budget failures are replaced by upload rejection or disabled endpoint errors.
**Migration**: Use backend contract validation errors and named SQL diagnostics.

## ADDED Requirements

### Requirement: Disabled action runtime cannot affect named SQL
The disabled hosted action runtime SHALL NOT create workers, load action bundles, or access the application database.

#### Scenario: action endpoint called while disabled
- **WHEN** a request calls a disabled hosted action endpoint
- **THEN** the platform MUST return before any action worker, VM module, bundle load, or action ctx SQL execution occurs
- **AND** later named SQL requests for the same app MUST remain unaffected by that rejected call

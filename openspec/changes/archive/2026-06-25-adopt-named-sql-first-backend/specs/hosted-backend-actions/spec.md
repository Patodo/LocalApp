## REMOVED Requirements

### Requirement: Hosted action endpoint
**Reason**: Hosted action execution is no longer a stable default platform capability because the current runtime can enter a platform-wide bad state after action failures.
**Migration**: Use registered named query, registered named mutation, transaction mutation, or platform-provided primitives.

### Requirement: Action definition model
**Reason**: Applications should not define executable backend JavaScript as part of the stable upload contract.
**Migration**: Express data capabilities in backend resource schemas, queries, mutations, and migrations.

### Requirement: Trusted action context
**Reason**: The trusted ctx model depends on hosted action execution, which is being disabled by default.
**Migration**: Use named SQL system variable injection and transaction mutation for trusted server-side data writes.

### Requirement: Action access control
**Reason**: Action access control is no longer needed for disabled action handlers.
**Migration**: Use access declarations on named query, named mutation, and platform routes.

### Requirement: Action input validation
**Reason**: Action handler input validation is no longer part of the stable backend path.
**Migration**: Use named SQL parameter schemas and platform primitive input schemas.

### Requirement: Runtime restrictions
**Reason**: The runtime is disabled instead of being exposed with restrictions.
**Migration**: Move stable backend logic to named SQL and platform-provided primitives.

### Requirement: Action transaction boundary
**Reason**: Action transaction support depends on hosted JavaScript execution.
**Migration**: Use transaction mutation for database-only short transactions.

### Requirement: Action observability and errors
**Reason**: Hosted action execution is disabled, so action observability for successful execution is no longer applicable.
**Migration**: Named SQL and transaction mutation diagnostics remain the stable observability path.

### Requirement: Hosted action scope boundary
**Reason**: The platform no longer exposes hosted actions as a scoped stable capability.
**Migration**: Use named SQL-first backend contracts.

### Requirement: Standard action budget errors
**Reason**: Runtime budget errors are replaced by a stable hosted-actions-disabled response.
**Migration**: Use named SQL result budget errors and transaction mutation errors.

### Requirement: Hosted action is a constrained business command layer
**Reason**: Even constrained action usage still depends on the unstable hosted runtime.
**Migration**: Use transaction mutation or request a platform primitive for reusable command orchestration.

### Requirement: Action ctx exposes only declared named SQL
**Reason**: Action ctx is no longer exposed in the stable runtime.
**Migration**: Frontend and app tools call registered named SQL directly through SDK/client APIs.

### Requirement: Action query usage requires bounded named query
**Reason**: Hosted action query usage is removed from the stable path.
**Migration**: Bounded named queries remain available directly through the named SQL API.

## ADDED Requirements

### Requirement: Hosted action endpoint disabled response
The action endpoint SHALL NOT execute application-uploaded hosted action code in the stable platform path.

#### Scenario: 调用旧版本 action endpoint
- **WHEN** a request calls `POST /serve/:owner/:app/api/actions/:name`
- **THEN** server MUST return a non-success response with stable code `hosted_actions_disabled` or equivalent
- **AND** server MUST NOT load or execute the action bundle

#### Scenario: 禁用错误包含迁移指引
- **WHEN** server rejects an action call because hosted actions are disabled
- **THEN** the response error MUST mention named SQL, transaction mutation, or platform primitives as the migration path

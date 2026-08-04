## ADDED Requirements

### Requirement: Hosted action scope boundary
Hosted backend action SHALL be positioned as a short-lived server-side orchestration mechanism for trusted platform capabilities, not as the default backend layer for ordinary reads and CRUD.

#### Scenario: action implements short write orchestration
- **WHEN** an application uses an action for approval, state transition, cascade delete, permission-sensitive write, notification orchestration, or synchronous server-side validation
- **THEN** the platform MUST allow the action when it stays within runtime budgets and ctx boundaries

#### Scenario: action implements unpaginated read model
- **WHEN** an action attempts to load multiple large query results and return an unpaginated full read model
- **THEN** the platform MUST be allowed to reject the action through resource budgets
- **AND** developer-facing guidance MUST direct the application to paginated named SQL, SQL aggregation, filtering, JOINs, or frontend assembly

### Requirement: Standard action budget errors
Action endpoint responses SHALL expose stable error codes for resource budget, scheduling, queue and result-size failures.

#### Scenario: action result exceeds platform budget
- **WHEN** an action result exceeds the configured result size budget
- **THEN** `POST /serve/:owner/:app/api/actions/:name` MUST return `{ success: false, error, code }`
- **AND** `code` MUST be stable enough for SDK and developer tooling to recognize the failure category

#### Scenario: action waits too long for runtime capacity
- **WHEN** an action request cannot obtain runtime capacity before queue timeout
- **THEN** the endpoint MUST return a non-success response with an action queue timeout code
- **AND** the handler MUST NOT execute after the timeout response is sent

## ADDED Requirements

### Requirement: SDK exposes actor command client separately from named SQL
SDK SHALL provide a distinct API for invoking App Backend Actor commands while keeping named SQL query/mutation APIs as the default data path.

#### Scenario: invoke actor command
- **WHEN** an app calls the SDK actor command helper with a command name and input
- **THEN** SDK MUST send the request to the actor command API surface
- **AND** SDK MUST surface structured actor errors as `LocalAppError` or the platform-standard error type

#### Scenario: no implicit fallback to actor
- **WHEN** a named query or named mutation fails
- **THEN** SDK MUST NOT automatically retry the request through actor commands
- **AND** actor command calls MUST be explicit in application code

### Requirement: SDK documents actor as advanced optional path
SDK documentation and generated guidance SHALL present actor commands as an advanced optional path for backend orchestration, not the default replacement for named SQL.

#### Scenario: developer reads SDK guidance
- **WHEN** developers read SDK docs or generated app guidance
- **THEN** named SQL and transaction mutation MUST be shown before actor command examples
- **AND** actor guidance MUST list the categories of problems that justify actor usage

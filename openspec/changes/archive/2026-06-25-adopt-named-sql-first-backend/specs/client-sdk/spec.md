## ADDED Requirements

### Requirement: SDK does not recommend hosted action calls
The SDK and generated app guidance SHALL NOT present hosted action calls as the default stable backend integration path.

#### Scenario: SDK public API documentation
- **WHEN** developers read SDK documentation or generated template guidance
- **THEN** examples MUST use `client.query`, `client.mutate`, transaction mutation helpers, or resource hooks
- **AND** examples MUST NOT recommend hosted action calls for ordinary business logic

#### Scenario: SDK transaction result references
- **WHEN** developers need to pass an earlier transaction step result into a later mutation parameter
- **THEN** the SDK MUST provide a typed helper for constructing supported transaction result references
- **AND** generated guidance MUST show how to reference `lastInsertRowId` for create-then-child-write flows

#### Scenario: action call helper exists from older runtime
- **WHEN** legacy SDK code still exposes an action-call helper
- **THEN** documentation MUST mark it unsupported or experimental
- **AND** runtime errors from disabled action endpoints MUST surface as `LocalAppError` with the stable disabled capability code when available

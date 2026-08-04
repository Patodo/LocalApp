## ADDED Requirements

### Requirement: SDK exposes named query and mutation calls
SDK SHALL expose first-class methods for calling registered named SQL APIs without accepting SQL text from the frontend.

#### Scenario: call named query
- **WHEN** app code calls `client.query(name, params)`
- **THEN** SDK MUST POST params to `/api/queries/:name`

#### Scenario: call named mutation
- **WHEN** app code calls `client.mutate(name, params)`
- **THEN** SDK MUST POST params to `/api/mutations/:name`

### Requirement: SDK keeps resource API compatibility
SDK SHALL keep existing resource API methods while allowing them to resolve through backend contract system endpoints.

#### Scenario: existing app calls list
- **WHEN** existing app code calls `client.list(resource)`
- **THEN** SDK MUST preserve existing call shape and return shape

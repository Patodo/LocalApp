## ADDED Requirements

### Requirement: App Backend Actor is not a hosted action
系统 SHALL distinguish App Backend Actor from legacy hosted backend actions. Disabling hosted actions MUST NOT imply disabling named SQL or any future explicit actor capability.

#### Scenario: legacy action endpoint remains disabled
- **WHEN** an app calls `POST /serve/:owner/:app/api/actions/:name`
- **THEN** server MUST continue to return `hosted_actions_disabled`
- **AND** server MUST NOT route that request to App Backend Actor

#### Scenario: actor command uses separate API surface
- **WHEN** an app invokes an App Backend Actor command
- **THEN** the request MUST use a distinct actor command API
- **AND** the request MUST be authorized and validated through the actor command contract

### Requirement: Hosted action files are not actor declarations
Legacy hosted action source, manifest, and bundle files SHALL remain unsupported backend contract files and MUST NOT be accepted as actor declarations.

#### Scenario: upload legacy action files with actor enabled
- **WHEN** an app declares backend actor and also uploads `backend/actions.manifest.json`, `backend/actions.bundle.mjs`, or `backend/actions/**`
- **THEN** validate and upload MUST fail
- **AND** the error MUST explain that actor commands require the new actor contract format

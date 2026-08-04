# hosted-action-runtime Specification

## Purpose

Hosted backend action execution is not a stable LocalApp runtime capability. The platform keeps a diagnostic API surface for legacy callers, but it must not load application action bundles, start action workers, or let action runtime failures affect named SQL.

## Requirements

### Requirement: Hosted action runtime disabled by default
平台 SHALL NOT execute uploaded hosted backend action JavaScript in the stable runtime.

#### Scenario: legacy action endpoint is called
- **WHEN** a caller posts to `/serve/:owner/:app/api/actions/:name`
- **THEN** platform MUST return a stable non-success response with code `hosted_actions_disabled`
- **AND** the response MUST point developers to named SQL, transaction mutation, or platform primitives
- **AND** platform MUST NOT load `actions.manifest.json`, load `actions.bundle.mjs`, or start a worker

#### Scenario: named SQL after disabled action call
- **WHEN** an action request is rejected as disabled
- **THEN** subsequent named query and named mutation requests for the same app MUST remain usable without restarting the server

### Requirement: Disabled action runtime cannot affect named SQL
The disabled hosted action runtime SHALL NOT create workers, load action bundles, or access the application database.

#### Scenario: action endpoint called while disabled
- **WHEN** a request calls a disabled hosted action endpoint
- **THEN** the platform MUST return before any action worker, VM module, bundle load, or action ctx SQL execution occurs
- **AND** later named SQL requests for the same app MUST remain unaffected by that rejected call

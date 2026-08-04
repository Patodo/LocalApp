## ADDED Requirements

### Requirement: Backend contract declares actor capability explicitly
Backend contract files SHALL provide an explicit declaration for App Backend Actor when an application needs platform-hosted backend command orchestration.

#### Scenario: actor declaration present
- **WHEN** manifest/backend contract declares actor enabled
- **THEN** validate MUST require actor command contract files, capability declarations, and resource budgets
- **AND** upload MUST include actor contract files as versioned application metadata

#### Scenario: actor declaration absent
- **WHEN** manifest/backend contract does not declare actor enabled
- **THEN** validate and upload MUST NOT require actor files
- **AND** server MUST NOT create actor runtime state for that app version

### Requirement: Actor contract packaging excludes unsupported files
Actor packaging SHALL include only declared actor bundle and contract metadata and MUST reject unsupported runtime files.

#### Scenario: unsupported backend files
- **WHEN** actor packaging discovers files outside declared actor bundle, actor contract, schemas, named SQL, migrations, or policies
- **THEN** validate MUST either ignore undeclared files or fail with a clear unsupported backend file error according to manifest include rules

#### Scenario: actor bundle exceeds limit
- **WHEN** actor bundle size exceeds the platform maximum
- **THEN** validate and upload MUST fail before creating a new app version

### Requirement: Actor capability declarations are validated
Actor contract files SHALL declare every non-default platform capability used by actor code.

#### Scenario: undeclared capability
- **WHEN** actor code or metadata references `ctx.http`, `ctx.ai`, `ctx.storage`, `ctx.notify`, `ctx.job`, or `ctx.cache`
- **AND** the actor contract does not declare the corresponding capability
- **THEN** validate MUST fail when the use can be detected statically
- **AND** runtime MUST reject the capability call even if static validation misses it

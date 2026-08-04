## REMOVED Requirements

### Requirement: Backend actions discovery
**Reason**: Hosted action source discovery is no longer part of stable backend contract processing.
**Migration**: Remove backend action source files and express capabilities as schemas, named queries, named mutations, or migrations.

### Requirement: Action manifest packaging
**Reason**: Action manifests and bundles must not be packaged into stable uploaded versions.
**Migration**: Remove `actions.manifest.json` and `actions.bundle.mjs`; use named SQL contract files.

### Requirement: Action contract validation
**Reason**: Action manifests are rejected rather than validated for execution.
**Migration**: Validate named SQL and transaction mutation contracts instead.

### Requirement: Action contract declares execution intent and SQL uses
**Reason**: Hosted action execution intent is no longer supported in stable backend contracts.
**Migration**: Declare query/mutation capabilities directly in backend resource contract files.

### Requirement: Upload rejects unbounded action read models
**Reason**: Upload rejects all hosted action files, so action-specific read-model detection is no longer needed.
**Migration**: Direct named queries must still declare and obey bounded result contracts.

## ADDED Requirements

### Requirement: Upload rejects hosted action contract files
CLI validate, CLI upload, and server upload SHALL reject hosted action source, manifest, and bundle files for stable app versions.

#### Scenario: action manifest present
- **WHEN** an uploaded project contains `actions.manifest.json`
- **THEN** validate and upload MUST fail before creating a new app version
- **AND** the error MUST identify hosted actions as disabled

#### Scenario: action bundle present
- **WHEN** an uploaded project contains `actions.bundle.mjs`
- **THEN** validate and upload MUST fail before creating a new app version
- **AND** the current app version MUST remain unchanged

#### Scenario: action source present
- **WHEN** backend discovery finds files under `backend/actions/`
- **THEN** validate MUST fail with guidance to migrate to named SQL-first backend contracts

### Requirement: Backend contract excludes disabled action files
Backend contract packaging SHALL include schemas, named queries, named mutations, migrations, policies, and validation metadata, but MUST NOT include disabled hosted action files.

#### Scenario: backend root contains mixed files
- **WHEN** backend root contains resource contract files and hosted action files
- **THEN** validate MUST reject the project rather than silently packaging only part of the backend
- **AND** the error MUST tell the developer which action files to remove or migrate

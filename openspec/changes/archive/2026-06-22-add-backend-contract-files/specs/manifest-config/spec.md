## ADDED Requirements

### Requirement: Manifest declares backend contract location
manifest SHALL support a `backend` section that declares where application backend contract files are located without embedding schema or SQL definitions directly in manifest.

#### Scenario: backend root declared
- **WHEN** manifest includes `backend.root`
- **THEN** CLI and runtime MUST use that root to discover backend contract files

#### Scenario: manifest embeds SQL definitions
- **WHEN** manifest attempts to define named SQL inline
- **THEN** validate MUST reject the inline SQL definition and instruct the developer to use backend files

### Requirement: Manifest backend declaration is packaged
上传时，平台 SHALL preserve manifest backend declaration alongside resolved backend contract metadata for the uploaded app version.

#### Scenario: uploaded app has backend declaration
- **WHEN** an app with backend declaration is uploaded
- **THEN** production server MUST be able to resolve the uploaded backend contract without reading the developer working directory

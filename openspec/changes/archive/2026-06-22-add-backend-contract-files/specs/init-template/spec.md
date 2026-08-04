## ADDED Requirements

### Requirement: Init template includes backend contract directory
init-repo SHALL include a default backend directory containing resource schema files, system CRUD named SQL definitions, custom SQL examples and local JSON Schema files.

#### Scenario: new project initialized
- **WHEN** user runs `localapp init`
- **THEN** generated project MUST contain a backend contract directory with examples and `$schema` references

#### Scenario: developer opens backend JSON
- **WHEN** developer opens a backend JSON file in an editor that understands JSON Schema
- **THEN** the file SHOULD provide validation and completion through its `$schema` reference

### Requirement: Init skills teach backend contract model
init-repo skills SHALL explain that application-level SQLite APIs are maintained as backend contract files and that platform data APIs remain platform-owned.

#### Scenario: app developer needs custom query
- **WHEN** app developer asks an agent to add a custom SQL-backed data view
- **THEN** skills MUST instruct the agent to add or modify a named SQL backend contract file instead of placing SQL in frontend code

#### Scenario: app developer needs platform users
- **WHEN** app developer needs platform user information
- **THEN** skills MUST instruct the agent to use platform-provided APIs rather than querying platform SQLite through backend SQL

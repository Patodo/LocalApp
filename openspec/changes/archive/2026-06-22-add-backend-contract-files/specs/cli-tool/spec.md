## ADDED Requirements

### Requirement: Schema CLI commands do not register application schemas
CLI SHALL NOT provide a normal workflow that creates, updates, or deletes application schemas directly in platform state once backend contract files are the schema source of truth.

#### Scenario: legacy schemas command is invoked
- **WHEN** user invokes a legacy `localapp schemas create`, `localapp schemas update`, or `localapp schemas delete` command
- **THEN** CLI MUST exit with a deprecation message that instructs the user to edit backend contract files and run validate/upload

#### Scenario: upload processes schema changes
- **WHEN** user edits backend resource schema files and runs `localapp upload`
- **THEN** CLI MUST treat those files as the source of application schema changes

### Requirement: Schema scaffold writes backend resource files
CLI schema/resource generation SHALL write files under the backend contract directory instead of the legacy `schemas/` directory.

#### Scenario: generate resource scaffold
- **WHEN** user invokes the supported resource scaffold command for `work_items`
- **THEN** CLI MUST create `backend/resources/work_items/schema.json`, `queries.json`, and `mutations.json` with `$schema` references

#### Scenario: legacy generate schema alias
- **WHEN** user invokes a retained `localapp generate schema work_items` compatibility alias
- **THEN** CLI MUST create backend resource contract files and MUST NOT create `schemas/work_items.json`

### Requirement: CLI help points to backend contracts
CLI help text and generated messages SHALL describe backend contract files as the supported way to manage application schemas.

#### Scenario: user reads generate help
- **WHEN** user runs CLI help for schema/resource generation
- **THEN** help text MUST mention backend resource contract files and MUST NOT mention `localapp schemas create`

## Purpose

This spec describes raw SQL execution as a restricted diagnostic or compatibility capability rather than the normal frontend runtime data API.

## Requirements

### Requirement: Raw SQL is not a normal frontend runtime API
Raw SQL execution SHALL be treated as a dev, owner-admin, or compatibility capability and SHALL NOT be exposed as the recommended normal frontend runtime data API for ordinary application users.

#### Scenario: ordinary user attempts raw SQL
- **WHEN** an ordinary application user calls `/api/db/exec` without owner-admin or explicit dangerous compatibility permission
- **THEN** server MUST reject the request before executing SQL

#### Scenario: developer needs diagnostics
- **WHEN** DevShell diagnostics inspect a development context
- **THEN** raw SQL MAY execute subject to dev-only safeguards

### Requirement: SDK raw SQL is deprecated path
SDK documentation and init-repo skills SHALL guide developers toward named query / mutation APIs instead of `client.exec(sql)` for production app behavior.

#### Scenario: developer reads data API guidance
- **WHEN** init-repo skills describe custom SQL-backed application APIs
- **THEN** they MUST recommend registered named SQL and MUST NOT recommend frontend-submitted arbitrary SQL

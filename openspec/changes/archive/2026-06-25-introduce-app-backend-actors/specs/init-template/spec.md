## ADDED Requirements

### Requirement: Template explains when not to use actor
init-repo guidance SHALL teach application developers and agents that App Backend Actor is optional and should not be used for ordinary CRUD, bounded lists, simple transactions, or local read-model assembly.

#### Scenario: generated guidance for common CRUD app
- **WHEN** an agent builds a simple form, CRUD, dashboard, or bounded list application from the template
- **THEN** guidance MUST direct it to named SQL, transaction mutation, and platform primitives
- **AND** guidance MUST NOT suggest creating an actor

### Requirement: Template includes minimal actor example only when actor is requested
init-repo SHALL include actor guidance or examples in a way that does not cause default apps to upload actor files unless the developer explicitly opts in.

#### Scenario: default init project
- **WHEN** `localapp init` creates a default project
- **THEN** the project MUST NOT contain enabled actor contract or actor bundle files by default

#### Scenario: developer opts into actor
- **WHEN** a developer or agent explicitly chooses the actor path
- **THEN** guidance MUST show a minimal command using `ctx.auth`, `ctx.db.transaction`, and structured input/output
- **AND** guidance MUST state that direct DB, filesystem, port listening, and undeclared network access are forbidden

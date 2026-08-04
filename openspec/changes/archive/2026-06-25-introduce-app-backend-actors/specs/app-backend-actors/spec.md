## ADDED Requirements

### Requirement: Actor is explicit and optional
系统 SHALL 默认使用 named SQL、transaction mutation 和平台原语作为应用后端路径，并且仅在应用显式声明 backend actor 时创建或运行 actor。

#### Scenario: 未声明 actor 的应用
- **WHEN** 应用未在 manifest 或 backend contract 中声明 backend actor
- **THEN** 平台 MUST NOT build、upload、start 或 route requests to an app backend actor
- **AND** 应用 MUST continue to use named SQL and platform primitives through existing APIs

#### Scenario: 声明 actor 的应用
- **WHEN** 应用显式声明 backend actor and uploads a valid actor bundle and command contract
- **THEN** 平台 MAY start an app/version scoped actor lazily when the first actor command is invoked
- **AND** 平台 MUST keep named SQL APIs available independently of actor runtime state

### Requirement: Actor lifecycle is app-version scoped
平台 SHALL manage app backend actors by owner, app name, and version, with lazy start, bounded concurrency, idle recycling, and version switch isolation.

#### Scenario: actor cold start
- **WHEN** a command is invoked for an app version without a warm actor
- **THEN** 平台 MUST start an actor for that owner/app/version within configured startup timeout
- **AND** failure to start MUST return a structured actor runtime error

#### Scenario: actor idle recycle
- **WHEN** an actor has no in-flight command and remains idle beyond the configured timeout
- **THEN** 平台 MUST be able to dispose the actor without losing authoritative application state

#### Scenario: version switch
- **WHEN** an app uploads a new current version
- **THEN** new actor commands MUST route to the new version actor
- **AND** the previous version actor MUST be drained or disposed without receiving new commands

### Requirement: Actor capabilities are mediated through ctx
Actor code SHALL access platform resources only through a platform-provided `ctx` object. Actor code MUST NOT directly open databases, listen on ports, read arbitrary filesystem paths, or access the network without declared platform capability.

#### Scenario: named SQL from actor
- **WHEN** actor code needs application data
- **THEN** it MUST call registered named query, named mutation, or transaction mutation through `ctx.db`
- **AND** it MUST NOT execute raw SQL or directly access the SQLite/sql.js database file

#### Scenario: external HTTP access
- **WHEN** actor code needs external HTTP access
- **THEN** the application MUST declare an HTTP capability with an allowlist
- **AND** runtime MUST reject requests outside the allowlist

#### Scenario: AI access
- **WHEN** actor code calls `ctx.ai`
- **THEN** 平台 MUST use platform-managed AI configuration and enforce token, cost, timeout, and audit limits

### Requirement: Actor commands have contracts
Actor SHALL expose named commands with declared input schema, output schema or result budget, access policy, required capabilities, timeout, memory budget, and response size budget.

#### Scenario: command contract missing
- **WHEN** an app declares actor enabled but a command lacks input schema, access policy, or resource budget
- **THEN** validate and upload MUST fail before creating a new app version

#### Scenario: command invocation
- **WHEN** a client invokes an actor command
- **THEN** server MUST validate input before executing the command
- **AND** server MUST enforce access policy before invoking actor code
- **AND** server MUST validate or budget the output before returning it to the client

### Requirement: Actor runtime errors are structured and isolated
Actor runtime failures SHALL return stable error codes and MUST NOT corrupt named SQL, upload, static serving, or other app versions.

#### Scenario: actor timeout
- **WHEN** an actor command exceeds its timeout
- **THEN** server MUST return an actor timeout error code
- **AND** server MUST keep named query and named mutation APIs usable for the same app

#### Scenario: actor memory exceeded
- **WHEN** actor memory usage exceeds the configured budget
- **THEN** server MUST terminate or recycle the actor
- **AND** server MUST return an actor memory error code rather than an unwrapped low-level runtime error

#### Scenario: actor crash
- **WHEN** actor code crashes or its worker exits unexpectedly
- **THEN** server MUST return a structured actor crash error
- **AND** subsequent named SQL requests MUST remain unaffected

### Requirement: Actor runtime requires stability gate
平台 SHALL NOT mark App Backend Actor as stable until a runtime spike validates isolation, resource limits, crash behavior, startup overhead, and local development compatibility.

#### Scenario: runtime implementation selected
- **WHEN** an implementation chooses worker_threads, isolate, process sandbox, or another runtime
- **THEN** the change MUST document measured trade-offs for startup latency, memory isolation, crash containment, bundle format, dependency support, and operational complexity

#### Scenario: stability gate fails
- **WHEN** the runtime cannot provide clear error wrapping, bounded resource usage, and named SQL isolation
- **THEN** the actor capability MUST remain experimental and MUST NOT be exposed in generated default templates

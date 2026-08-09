# Unified Server and Optional Tray Design

**Status:** Approved design

**Date:** 2026-08-09

## Summary

LocalApp will have one canonical Server implementation and no separate MiniServer or Local Runtime product. The same Node.js Server artifact runs on a developer machine, a LAN host, a NAS, a container, or a public server. Deployment configuration changes listeners, storage providers, data directories, and public URLs; it does not select a different application runtime.

The Server owns the Web control plane, users, authentication, applications, workspaces, task execution, messages, files, backups, and peer synchronization. Local and remote Servers are independent, equal peers. They do not proxy or manage each other.

The primary distribution is the `@localapp/server` Node package. An optional tray-only Tauri distribution bundles and supervises the exact same Server artifact for users who want a signed installer, bundled Node runtime, autostart, and a system tray.

## Goals

- Use one Server package, one application API surface, and one user system in every deployment.
- Remove the MiniServer and fixed `local-user` concepts.
- Move all management UI from Desktop into the Server-hosted Web application.
- Reduce Desktop to an optional tray launcher with two actions: open home and exit.
- Give every Server a complete Web control plane that works offline.
- Support loopback-only operation by default and explicit LAN enablement.
- Treat Server instances as equal peers connected with target-user API keys.
- Synchronize portable application versions by default.
- Offer an explicit application-plus-data synchronization operation with snapshot replacement and rollback.
- Keep users, permissions, sessions, API keys, and platform-level data local to each Server.
- Start a new Server in a clean initial state without importing legacy Desktop data.

## Non-goals

- Automatic or continuous replication between peers.
- Record-level or conflict-merging data synchronization.
- User, permission, session, API-key, or platform-database synchronization.
- Remote Server management, API proxying, or implicit failover.
- Migration from the legacy Desktop or Local Runtime.
- Compatibility aliases for legacy local-install or upload workflows.
- A Tauri-hosted management window.
- Direct editing of arbitrary client filesystem directories from Studio.

## Product Model

### One Server

`@localapp/server` is the only application-hosting service. It includes:

- Web management and application pages.
- User authentication, roles, sessions, and API keys.
- Application installation, version history, activation, rollback, and health checks.
- Application migrations, backend contracts, Named SQL, content storage, and Platform Shell.
- Server-managed Studio workspaces.
- Agent tasks, logs, messages, cancellation, trust, and execution history.
- Backups, data import/export, and factory reset.
- Peer configuration and synchronization jobs.
- Capability and health endpoints.

The obsolete `@localapp/local-runtime` package is removed after its required application-serving behavior is incorporated into `@localapp/server`.

### Equal Peers

Every Server instance is independent and authoritative for its own:

- Users and roles.
- Application ownership and access rules.
- Business databases and uploaded files.
- Platform data, including issues, favorites, notifications, messages, and task history.
- Peer credentials and synchronization history.

A peer connection grants permission to push an application to another Server. It does not grant administrative control over the target Server and does not make either endpoint primary.

### Node Package Distribution

The canonical package exposes a `localapp-server` executable:

```bash
npm install -g @localapp/server
localapp-server start
```

The same package is usable from a project dependency, container image, system service, or bundled tray distribution.

### Optional Tray Distribution

The tray distribution is a convenience launcher, not a second client or runtime. It:

- Bundles a pinned build of `@localapp/server` and a compatible Node runtime.
- Starts and supervises the Server child process.
- Creates no main window or WebView.
- Provides exactly two menu items: `打开主页` and `退出本地服务`.
- Opens the Server homepage in the system browser.
- Stops the Server before exiting.
- Supports signed installers, autostart, and application updates.
- Reports startup failure through tray state, structured logs, and a system notification without adding menu items.

The tray and direct Node distributions must execute byte-identical Server application bundles for the same release.

## Deployment Configuration

The Server reads one configuration model from a file in the data directory, with explicit environment-variable overrides for automated deployment.

The model contains:

- Listen host and port.
- Public URL.
- Data and workspace directories.
- Database configuration.
- Content-storage provider and credentials.
- Server master-key source.
- External executable paths and task limits.
- Logging and retention settings.

Deployment defaults are configuration defaults, not code branches:

- A new interactive installation listens on `127.0.0.1` only.
- LAN listening is enabled explicitly by an administrator in Web settings.
- Public deployments set their listener, public URL, TLS or reverse-proxy configuration, and storage provider explicitly.

Changing the listen address is transactional. The Server validates the requested address, persists the candidate configuration, responds to the initiating request, rebinds the listener, and rolls back the configuration if the new listener cannot start.

Non-loopback HTTP requires an explicit insecure-LAN acknowledgement. HTTPS or a trusted reverse proxy is the recommended LAN and public configuration.

## Identity and Initial Setup

There is no special local identity. All deployments use the same user, role, password, session-cookie, API-key, and authorization code.

When a Server database contains no users:

1. The Server enters setup-only state.
2. It generates a cryptographically random, short-lived, single-use setup token.
3. `localapp-server start` prints a setup URL containing the token.
4. The tray opens that URL when the user chooses `打开主页`.
5. The setup page creates the first administrator.
6. Successful administrator creation consumes every outstanding setup token.
7. All later requests use normal login and session handling.

Interactive setup is loopback-only. Automated deployment may supply a setup token through an environment variable, but the token still expires when the first administrator is created.

Only an administrator can create users, manage roles, generate API keys, configure peers, change network listeners, or configure storage providers.

## Web Control Plane

`packages/web` becomes the only management UI. The Server serves the same Web build in every deployment.

The control plane provides:

- Instance home: health, version, listener, storage, application, workspace, and task summaries.
- Applications: install, open, version history, activate, rollback, backup, data management, and peer synchronization.
- Studio: create, Git clone, archive import, edit, build, test, package, and install.
- Tasks and messages: create, inspect, stream logs, cancel, review results, and browse history.
- Peers: add URL and API key, test connection, inspect capabilities, synchronize, and remove credentials.
- Users and access: users, roles, API keys, sessions, and application permissions.
- System settings: network, public URL, storage, data directories, external tools, logs, and diagnostics.

Web pages call only same-origin Server APIs. Secrets stored by the Server are never serialized into page responses.

## Application Runtime

Application routes use the hosted path model in every deployment:

```text
http://127.0.0.1:<port>/<owner>/<app>/
https://server.example.com/<owner>/<app>/
```

The application API and raw-resource base use the same path-based contract in every deployment. The local `<app>.localhost` origin, local ticket exchange, and fixed local-owner routing are removed.

Application code, migrations, backend resources, Named SQL behavior, Platform Shell behavior, file APIs, authentication context, and authorization checks are identical because the same Server routes and shared core execute them.

## Studio Workspaces and Task Execution

Studio uses Server-owned workspaces under the configured data directory:

```text
<data-dir>/workspaces/<workspace-id>/
```

Projects enter Studio by creation, Git clone, or archive import. The browser cannot select or expose arbitrary filesystem directories.

The Server task service executes build, test, Git, and Agent commands in a workspace. Local and public deployments use the same implementation. Capability checks report missing external tools such as Git, Node, Codex, or OpenCode and provide configuration guidance.

Task execution enforces:

- A workspace-root boundary.
- Explicit executable allowlists and configured paths.
- Per-task time and output limits.
- Cancellation and child-process cleanup.
- Persisted task status and structured logs.
- Existing publisher and trust checks where remote instructions can execute code.

## Peer Configuration and Security

A peer record contains:

- Local display name.
- Target Server base URL.
- Target-user API Key.
- Last verified target identity, Server version, and capability snapshot.
- Creation and last-success timestamps.

The target API Key is encrypted with the source Server master key. It is accepted from the browser only when a peer is created or its credential is replaced. It is never returned through an API, log, task payload, or synchronization record.

Peer verification checks:

- HTTPS or explicit insecure-LAN approval.
- Health and protocol version.
- Required synchronization capabilities.
- API-key identity and authorization.
- Maximum accepted package and snapshot sizes.

Synchronization is always a source-initiated push. Reverse synchronization is performed by configuring the opposite peer connection and initiating a push from the other Server.

## Synchronization Protocol

### Target Ownership

The target API Key identifies the target owner. The source application name is preserved. If that owner has no application with the name, synchronization creates it. If the name already exists, synchronization installs a new version.

### Session API

The peer protocol uses authenticated, idempotent synchronization sessions:

1. `GET /api/peer/capabilities` validates protocol and limits.
2. `POST /api/peer/sync-sessions` creates a target staging session from application metadata, mode, version, and digests.
3. `PUT /api/peer/sync-sessions/:id/package` uploads the portable application package.
4. `PUT /api/peer/sync-sessions/:id/data` uploads the optional data snapshot over the authenticated transport.
5. `POST /api/peer/sync-sessions/:id/commit` validates and atomically applies the staged content.
6. `DELETE /api/peer/sync-sessions/:id` cancels and removes uncommitted staging data.

All peer endpoints require a target-user API Key and enforce that user's application permissions. Repeating an upload with the same synchronization ID and digest is safe.

### Application-only Synchronization

The source generates a deterministic package containing:

- Manifest.
- Built static assets.
- Migrations.
- Backend resource schemas, queries, and mutations.
- Package metadata, version, and content digests.

The target stages the package, validates the manifest and platform version, verifies every digest, validates the backend contract, backs up affected target state, applies migrations, installs the new version, runs application health checks, and atomically activates it.

The target retains its existing business database, uploaded files, users, permissions, and platform data. A migration or health-check failure restores the previous version and database backup.

The same application version and digest is an idempotent success. The same version with a different digest is a `409` conflict and is never overwritten.

### Application-plus-data Synchronization

This mode is an explicit advanced operation:

1. The source pauses application writes.
2. It creates a consistent database and uploaded-file snapshot.
3. It resumes source writes after snapshot completion.
4. The target validates the application package and snapshot before mutation.
5. The target pauses application writes.
6. It creates a complete target backup.
7. It installs the application version and replaces the business database and uploaded files.
8. It runs schema, backend-contract, content, and application health checks.
9. It atomically activates the replacement and resumes writes.
10. Any failure restores the target application version, database, and files before writes resume.

The snapshot excludes users, roles, sessions, API keys, application permissions, platform configuration, issues, favorites, notifications, task history, messages, and peer records.

## Persistent Job State and Error Handling

Installation and synchronization use persisted jobs with these externally visible states:

```text
queued
staging
validating
backing-up
installing
activating
completed
rolled-back
failed
recovery-required
```

Temporary package, snapshot, and extraction paths live under a Server-owned staging root. Activation uses atomic directory and metadata transitions. The Server prunes abandoned staging sessions after a configured retention period.

Startup validates configuration, filesystem access, listener availability, database migrations, storage connectivity, and required Web assets. Invalid startup state fails fast with structured logs.

Rollback is itself verified. A job is marked `rolled-back` only after the previous version, database, and files pass integrity checks. If rollback verification fails, the application remains write-paused, the job enters `recovery-required`, and both backups are retained.

## CLI Changes

The Node package provides `localapp-server start` for running a Server.

The application-development CLI uses Server-targeted language:

```text
localapp app install --target <connection>
localapp app sync --peer <peer-name>
localapp app sync --peer <peer-name> --with-data
```

Legacy `localapp local install`, `localapp upload`, MiniServer, and Local Runtime commands are removed. They do not alias the new commands.

## Legacy Desktop Policy

The legacy Desktop product and its data are abandoned:

- No automatic detection or migration.
- No import wizard.
- No compatibility read path.
- No ownership mapping from `local-user`.
- No automatic deletion of legacy files.

A newly initialized Server contains only its first administrator. Applications, workspaces, peers, tasks, messages, and business data are empty.

## Testing Strategy

### Server Tests

- Unit tests for configuration, setup tokens, authentication, authorization, peer credential encryption, workspace boundaries, package validation, version conflicts, and job transitions.
- Integration tests for application serving, Platform Shell, Named SQL, files, backups, Studio workspaces, task cancellation, and network rebinding.

### Two-peer Tests

Tests start two instances from the same built Server artifact with independent data directories and ports. They verify:

- API-key identity and target ownership.
- New application synchronization.
- Existing application version synchronization.
- Idempotent repeat synchronization.
- Same-version/different-digest conflict rejection.
- Application-only synchronization preserving target data.
- Application-plus-data snapshot replacement.
- Users and platform data remaining independent.

### Failure Injection

Tests interrupt each state boundary and cover upload interruption, invalid digest, incompatible manifest, backend-contract failure, migration failure, insufficient disk space, file-copy failure, health-check failure, activation failure, and rollback failure.

### Browser End-to-End Tests

Browser tests cover first setup, login, user management, application installation and opening, Studio workspace lifecycle, task execution, peer creation, application synchronization, data synchronization confirmation, and LAN configuration.

### Distribution Acceptance

- A clean Node package installation starts a complete Server and serves the full Web control plane.
- The tray distribution creates no main window, exposes exactly two menu items, starts the bundled Server, opens the same Web control plane, and stops the child process on exit.
- Direct Node startup and tray startup run the same browser and API acceptance suites.
- The bundled Server application artifact digest matches the corresponding Node package release artifact.

## Delivery Boundaries

Implementation is organized into five independently verifiable tracks that converge on this design:

1. Consolidate application runtime, identity, storage, and Web serving into the canonical Server.
2. Move Desktop management features and server-managed workspaces into Web and Server APIs.
3. Add peer credentials, synchronization sessions, atomic install, snapshot replacement, and rollback.
4. Replace Desktop with the optional tray-only Server launcher and publish the Node package.
5. Remove Local Runtime, legacy Desktop UI, local-host routing, and obsolete CLI workflows; then run cross-distribution acceptance tests.

The repository may pass through temporary internal adapters while a track is under development, but the released result cannot expose separate Server and MiniServer behaviors.

## Acceptance Criteria

- The repository contains one canonical application-hosting Server implementation.
- A fresh Server initializes with no legacy applications or data.
- Local and public deployments use the same user and application runtime code.
- The Server Web UI contains every management feature formerly exposed by Desktop.
- Studio operates only on Server-managed workspaces.
- Application URLs use the same path model locally and remotely.
- Two independently initialized Servers can synchronize an application through a target-user API Key.
- Application-only synchronization preserves target business data.
- Application-plus-data synchronization replaces target business data and files with verified rollback.
- No synchronization mode transfers users, permissions, credentials, or platform data.
- The Node package runs without Tauri.
- The optional tray has no main window and only `打开主页` and `退出本地服务`.
- Legacy Desktop and Local Runtime data are neither imported nor deleted automatically.

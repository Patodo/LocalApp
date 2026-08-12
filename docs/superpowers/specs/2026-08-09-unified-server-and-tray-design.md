# Unified Server and Legacy Native Bridge Design

**Status:** Server/runtime/synchronization sections remain authoritative. The distribution, CLI, Desktop, Scheme bridge, and notification sections are superseded by [Single npm Package, User Daemon, Scheme, and Notifications](./2026-08-12-single-package-daemon-notifications-design.md).

**Date:** 2026-08-09; revised 2026-08-11; partially superseded 2026-08-12

> Historical boundary: references below to an optional Tauri tray, a separate
> `@localapp/server` installation, or the Rust application-development CLI
> describe the completed intermediate architecture. They must not be restored
> after the 2026-08-12 single-package revision. The one-Server, equal-peer,
> Device Action, synchronization, data-isolation, and application-runtime
> contracts remain in force.

## Summary

LocalApp will have one canonical Server implementation and no separate MiniServer or Local Runtime product. The same Node.js Server artifact runs on a developer machine, a LAN host, a NAS, a container, or a public server. Deployment configuration changes listeners, storage providers, data directories, and public URLs; it does not select a different application runtime.

The Server owns the Web control plane, users, authentication, applications, workspaces, task execution, messages, files, backups, and peer synchronization. Local and remote Servers are independent, equal peers. They do not proxy or manage each other.

The primary distribution is the `@localapp/server` Node package. An optional windowless Tauri distribution bundles and supervises the exact same Server artifact and provides the native bridge that owns the `localapp://` URL scheme. The bridge contains no application-hosting or script-execution backend of its own.

The Server also provides generic Device Actions. Any hosted application may ask the browser to hand an action to the Server running on the computer where the user clicked. A SKILL marketplace is one consumer of this platform primitive, not a special Server subsystem.

## Goals

- Use one Server package, one application API surface, and one user system in every deployment.
- Remove the MiniServer and fixed `local-user` concepts.
- Move all management UI from Desktop into the Server-hosted Web application.
- Reduce Desktop to an optional native bridge and tray with two menu actions: open home and exit.
- Preserve a generic, SDK-accessible Device Action capability for Web applications that need explicitly trusted work on the current computer.
- Deliver Device Actions through `localapp://` without device registration, cross-device dispatch, or a permanent remote control channel.
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
- Compatibility CLI commands or application-facing aliases for legacy local-install/upload workflows. The Server may retain an authenticated deployment compatibility transport only when it normalizes the request into `.localapp` and invokes the sole formal installer.
- A Tauri-hosted management window.
- Direct editing of arbitrary client filesystem directories from Studio.
- Application-specific Device Action semantics such as SKILL catalog formats, resume records, package installation rules, or target-tool adapters.
- Selecting another computer from the Web or dispatching an action to a computer other than the one on which the Scheme link was activated.

## Product Model

### One Server

`@localapp/server` is the only application-hosting service. It includes:

- Web management and application pages.
- User authentication, roles, sessions, and API keys.
- Application installation, version history, activation, rollback, and health checks.
- Application migrations, backend contracts, Named SQL, content storage, and Platform Shell.
- Server-managed Studio workspaces.
- Agent tasks, logs, messages, cancellation, trust, and execution history.
- Device Action creation, activation, trust, local execution, recovery, and result reporting.
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

The same package is usable from a project dependency, container image, system service, or bundled tray distribution. Headless and public deployments retain the same application API but leave the loopback Device Action ingress disabled unless it is explicitly supplied a local control credential.

### Application Development Mode

`localapp dev` is an orchestration mode for the same Node Server package, not a second application service. It:

- resolves one canonical Server launcher from an explicit override, the project's `@localapp/server`, the CLI distribution, or `PATH`, and requires Node.js 24 or newer;
- starts the packaged `localapp-server` executable on `127.0.0.1` with a random port and a data directory below `<project>/tmp/localapp-dev/server`;
- initializes a real local Server administrator and CSPRNG API Key/password on first run, stores those credentials in private project-local files (`0600` on POSIX; current-user-only protected DACL on Windows), and never prints their values;
- builds a uniquely versioned development `.localapp` package and installs it through the ordinary `/api/me/apps/install` endpoint;
- writes only `serverUrl`, `userId`, `pageName`, `apiKey`, and the Vite port to `.localapp/dev-config.json`;
- starts Vite on loopback as a frontend compiler and credential-injecting reverse proxy; every application, identity, platform, upload, Issue, Named SQL, and content request reaches that same Server;
- binds unsafe proxy requests to the same browser with Origin and HttpOnly/SameSite CSRF checks, without exposing the API Key to browser code;
- waits at most 15 seconds for structured Server readiness, uses only the actual listener-derived strict loopback `listenUrl` for credentials and proxying (never a configured public display URL), and supervises both complete process trees, so either child exit or an interrupt stops and waits for all descendants. Unix uses process groups; Windows atomically creates each root suspended, assigns it to a kill-on-close Job Object before user code can run, and only then resumes it, so even immediate descendants cannot escape supervision.

Durable project policy is separate from that replaceable runtime context. `autoSync` and the monotonic `ejected` marker live in `.localapp/project-config.json`. On first read, the CLI migrates legacy copies from `dev-config.json` by atomically publishing the durable file before atomically cleaning the temporary file, so an interrupted migration is idempotent and cannot re-enable synchronization or undo eject.

The same Server may expose `/api/dev/*` helpers only when started with the explicit development-tools flag. These authenticated, loopback-only helpers maintain simulated identity/time context, application-data reset and snapshots, current-user diagnostics, and business metadata. They validate the application name and resolved data path before access and are not registered in ordinary local, LAN, container, or public startup. Development context is scoped to one Server data root, user, and application and is cleared when that Server closes.

CLI migration/type commands may use `<project>/tmp/localapp-schema/schema.db` as an offline schema workbench. That file is compiler input/output only: it does not serve HTTP, hold runtime application state, or constitute another backend. Runtime data reset, snapshot, and restore always execute inside the current Server. Each installed version retains a private, checksum-recorded migration snapshot (including an explicit empty marker); historical layouts are backfilled only from their retained digest-verified package. Runtime reset verifies and reapplies the active snapshot and never applies another version, the source tree, or the source-only development seed.

### Optional Native Bridge and Tray Distribution

The tray distribution is a native Scheme bridge and convenience launcher, not a second application runtime. It:

- Bundles a pinned build of `@localapp/server` and a compatible Node runtime.
- Starts and supervises the Server child process.
- Registers `localapp://` with the operating system and enforces single-instance activation.
- Strictly parses an action activation URL, starts the Server when necessary, and forwards only the activation ticket to a loopback-only Server endpoint authenticated by an in-memory per-launch control secret. It may open only the loopback confirmation URL returned by that endpoint.
- Creates no main window or WebView.
- Provides exactly two menu items: `打开主页` and `退出本地服务`.
- Opens the Server homepage in the system browser.
- Stops the Server before exiting.
- Supports signed installers, autostart, and application updates.
- Reports startup failure through tray state, structured logs, and a system notification without adding menu items.

It does not fetch application scripts, decide trust, install SKILLs, access application databases, or execute actions. Those responsibilities remain in the canonical Server. A direct Node installation can host applications without Tauri; click-to-run Scheme activation requires an installed native bridge.

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
- Device Actions: pending confirmations, active and historical actions, publisher trust grants, permission changes, cancellation, and local logs.

Web pages call only same-origin Server APIs. Secrets stored by the Server are never serialized into page responses.

## Application Runtime

Application routes use the hosted path model in every deployment:

```text
http://127.0.0.1:<port>/<owner>/<app>/
https://server.example.com/<owner>/<app>/
```

The application API and raw-resource base use the same path-based contract in every deployment. The local `<app>.localhost` origin, local ticket exchange, and fixed local-owner routing are removed.

Application code, migrations, backend resources, Named SQL behavior, Platform Shell behavior, file APIs, authentication context, and authorization checks are identical because the same Server routes and shared core execute them.

## Generic Device Actions

### Product Boundary

Device Actions are a platform primitive exposed by the application SDK. A hosted application supplies a title, description, script, dependency map, JSON input, requested local permissions, and timeout. The platform owns transport, publisher attribution, trust, execution lifecycle, and result delivery. The application owns the meaning of the action and every domain-specific workflow built on its result.

The protocol therefore supports a SKILL marketplace, local export/import, CLI automation, file conversion, or hardware tooling without placing any of those products in Server Core.

### Source-to-Current-Computer Flow

1. An authenticated user clicks an application control in a Web application hosted by any LocalApp Server.
2. The SDK posts a Device Action request to that application's same-origin API.
3. The source Server validates the application, current version, publisher, request limits, and requested permission declaration, persists the action, and returns a short-lived activation URL. Its origin comes from canonical Server configuration, never an untrusted `Host` or forwarded header.
4. The browser opens a canonical URL containing only protocol version, source HTTPS or explicitly accepted local/LAN origin, action ID, and a high-entropy single-use nonce. The Scheme never contains the script, dependencies, API keys, session cookies, or user data.
5. The operating system activates the native bridge on that same computer. The bridge starts its bundled Server if needed and forwards the ticket through its authenticated loopback control endpoint.
6. The local Server claims the action from the source over HTTP(S), persists an action-scoped callback credential, and validates that the claimed metadata matches the ticket.
7. If no matching local trust grant exists, the local Server returns its own loopback confirmation URL and the bridge opens it in the system browser. The bridge verifies that the URL uses the exact ready origin and expected confirmation path. Only a local Server administrator may grant or revoke Device Action trust.
8. The local Server executes the action, persists state and bounded logs, and reports progress and the terminal result to the source using only the action-scoped credential.
9. The source Web page observes the persisted action through SSE with polling fallback.

Scheme activation always targets the computer on which the click occurred. There is no device picker, remote device registry, background connection to the source, peer requirement, or user-account synchronization.

### Trust and Permissions

A trust grant is keyed by normalized source origin, application owner and name, immutable publisher user ID, and a canonical permission-set digest. Display names are informational and never identify trust. Reuse searches grants under the same origin/application/publisher tuple and accepts a saved permission set only when it is a superset of the new request; the digest still gives every approved set an immutable identity.

The first action from a publisher requires local confirmation. A later action runs without another confirmation only when the source, application, publisher, and requested permissions are identical to or narrower than the saved grant. A publisher change, source-origin change, or permission expansion returns the action to `awaiting_trust`. Revocation affects later actions and does not silently terminate a currently running child process.

The permission declaration covers filesystem read roots, filesystem write roots, network access, child-process access, and the action's working directory. Filesystem grants resolve existing ancestors, reject symlink traversal outside an approved root, and are revalidated immediately before execution. The executor adds only its immutable runner and dependency-cache paths. It launches the bundled Node runtime with its permission system enabled, a minimal environment, no Server credentials, bounded input/result/log sizes, a bounded timeout, captured output, and process-tree cancellation. Until container isolation is introduced, granting child-process access is explicitly presented as arbitrary code execution under the current operating-system user.

### Protocol, Persistence, and Recovery

The source endpoints create actions, claim a specific action using its nonce, accept authenticated status updates, stream public status, and cancel active work. The local endpoints accept bridge activations, list pending confirmations, grant or revoke trust, expose local logs to administrators, and cancel local execution.

Activation, claim, and terminal updates are idempotent. A nonce expires when unclaimed, is bound to one local installation after claim, and cannot claim another action. Claim requests use a fixed path, no redirects, no ambient proxy/cookie/authentication state, bounded connect/response time and bytes, DNS/address revalidation, and an explicit source-origin policy: HTTPS by default, loopback HTTP for local development, and private-network HTTP only after local administrator opt-in. The source never returns a script through status or browser-facing responses. The local Server durably records a claimed action before execution; after restart it resumes preparation where safe and otherwise reports `interrupted`. The externally visible states remain `pending`, `claimed`, `awaiting_trust`, `preparing`, `running`, `succeeded`, `failed`, `cancelled`, `expired`, and `interrupted`.

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
localapp app sync --peer <peer-name> --with-data --confirm-app <app-name>
```

`localapp dev` remains as a convenience supervisor for the canonical Server plus Vite. It does not start a template-owned HTTP service or create a second application database.

Legacy `localapp local install`, `localapp upload`, MiniServer, and Local Runtime commands are removed. They do not alias the new commands. A retained authenticated `POST /api/upload` is only a Server-side deployment compatibility transport: it normalizes multipart input into `.localapp` and invokes the same installer as `/api/me/apps/install`; applications use `/api/content/upload` for files.

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

- Unit tests for configuration, setup tokens, authentication, authorization, peer credential encryption, workspace boundaries, package validation, version conflicts, Device Action ticket parsing, trust fingerprints, permissions, and job transitions.
- Integration tests for application serving, Platform Shell, Named SQL, files, backups, Studio workspaces, task cancellation, Device Action claim/execution/recovery, and network rebinding.

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

Browser tests cover first setup, login, user management, application installation and opening, Studio workspace lifecycle, task execution, peer creation, application synchronization, data synchronization confirmation, Device Action trust and execution, and LAN configuration. Formal self-verification uses the `browser:control-in-app-browser` skill against loopback URLs only.

Two applications provide the minimum realistic acceptance boundary:

- A SKILL marketplace application uses only the generic Device Action SDK. Clicking install activates the local Scheme bridge, prompts for first-publisher trust on the local Server, writes a fixture SKILL into `<repo>/tmp/unified-acceptance/installed-skills`, and reports success to the source Web page.
- A resume-management application uses Named SQL and content storage to create resume records, upload an image and a PDF, render the image with the template's preinstalled image-preview dependency, render the PDF with the template's preinstalled PDF dependency, and download both original files.

Both applications are initialized from the real built-in template, implemented through its shipped agent guidance, checked, packaged, installed into clean local Server data directories, and exercised at their formal `/<owner>/<app>/` URLs. Failures that reveal general application-development guidance gaps are fixed in the template skills or `AGENTS.md`, then the application is regenerated or corrected through the documented workflow.

### Distribution Acceptance

- A clean Node package installation starts a complete Server and serves the full Web control plane.
- The tray distribution creates no main window, exposes exactly two menu items, owns the Scheme bridge, starts the bundled Server, opens the same Web control plane, and stops the child process on exit.
- Direct Node startup and tray startup run the same browser and API acceptance suites.
- The bundled Server application artifact digest matches the corresponding Node package release artifact.

## Delivery Boundaries

Implementation is organized into five independently verifiable tracks that converge on this design:

1. Consolidate application runtime, identity, storage, and Web serving into the canonical Server.
2. Move Desktop management features and server-managed workspaces into Web and Server APIs.
3. Add peer credentials, synchronization sessions, atomic install, snapshot replacement, and rollback.
4. Preserve the generic local-action contract by moving trust and execution into Server, then replace Desktop with the optional Scheme bridge and tray and publish the Node package.
5. Remove Local Runtime, legacy Desktop UI, local-host routing, and obsolete CLI workflows; improve the application template and agent guidance; then run cross-distribution and two-application acceptance tests.

The repository may pass through temporary internal adapters while a track is under development, but the released result cannot expose separate Server and MiniServer behaviors.

## Acceptance Criteria

- The repository contains one canonical application-hosting Server implementation.
- A fresh Server initializes with no legacy applications or data.
- Local and public deployments use the same user and application runtime code.
- The Server Web UI contains every management feature formerly exposed by Desktop.
- Studio operates only on Server-managed workspaces.
- Application URLs use the same path model locally and remotely.
- `localapp dev` installs the application into the canonical Server package, keeps all runtime data below the project `tmp/` directory, and leaves development-only routes absent from ordinary Server startup.
- Two independently initialized Servers can synchronize an application through a target-user API Key.
- Application-only synchronization preserves target business data.
- Application-plus-data synchronization replaces target business data and files with verified rollback.
- No synchronization mode transfers users, permissions, credentials, or platform data.
- The Node package runs without Tauri.
- The optional tray has no main window and only `打开主页` and `退出本地服务`.
- Any hosted application can create a generic Device Action through the SDK, and Scheme activation executes it only on the computer where the user clicked.
- Scheme activation transfers no script or platform credential, and first-publisher or expanded-permission actions require local administrator confirmation.
- The SKILL marketplace acceptance application installs a fixture SKILL under the project `tmp` directory through the generic Device Action path.
- The resume-management acceptance application uploads, previews, and downloads image and PDF content using dependencies present in every newly initialized application.
- Application-development skills and `AGENTS.md` describe the unified Server, formal publish URL, Device Actions, content handling, and Browser verification without MiniServer or legacy upload commands.
- Legacy Desktop and Local Runtime data are neither imported nor deleted automatically.

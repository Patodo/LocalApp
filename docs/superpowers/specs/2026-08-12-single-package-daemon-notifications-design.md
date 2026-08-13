# Single npm Package, User Daemon, Scheme, and Notifications

**Status:** Approved

**Date:** 2026-08-12

## Summary

LocalApp is distributed to end users as one npm package named `localapp`.
Installing that package provides the `localapp` command, the canonical Node.js
Server, the Server-hosted Web control plane, the application-development
toolchain, the builtin application template, and the small operating-system
adapters required for `localapp://` activation and native notifications.

There is no Desktop product, Tauri application, tray, WebView, or second local
backend. On a personal computer, `localapp server` starts the canonical Server
as a per-operating-system-user daemon. On a container, NAS, LAN host, or public
machine, `localapp server run` runs the same Server in the foreground. The two
modes differ only in supervision and local-device integration.

The Node daemon performs all durable work: Server hosting, notification
subscriptions, reconnect/catch-up, activation validation, and routing. Small
native adapters only cross operating-system boundaries. They register the
custom URL scheme, display a system notification, and return a click or Scheme
activation to the daemon. They never host applications, store Server
credentials, fetch scripts, make trust decisions, or execute Device Actions.

This design supersedes the optional Tauri tray and separate Rust CLI portions
of the 2026-08-09 design. It preserves that design's one-Server model, equal
peers, complete multi-user authentication, application package format, atomic
synchronization, generic Device Actions, and local-only data ownership.

## Goals

- Require only a supported Node.js installation and one npm package install.
- Expose one public command, `localapp`, for Server and application workflows.
- Run the canonical Server as a resilient per-user daemon on personal
  computers and as a foreground process in headless deployments.
- Preserve `localapp://` for actions that must occur on the computer where the
  user clicked.
- Deliver Server inbox events as native operating-system notifications without
  adding a tray or application window.
- Support notifications from the local Server and explicitly enabled remote
  Server accounts.
- Make the Server inbox authoritative so offline, denied, or failed desktop
  delivery never loses the notification record.
- Remove the full Rust CLI and Tauri Desktop after TypeScript and native-adapter
  acceptance passes.
- Keep all local acceptance projects, Server data, uploads, downloads, package
  installs, and generated fixtures below this repository's `tmp/` directory.

## Non-goals

- A tray icon, menu-bar item, main window, WebView, or Electron/Tauri shell.
- A separate MiniServer, local runtime, Desktop backend, or local user model.
- APNs, WNS, or another cloud push provider in the first release. Immediate
  notification delivery requires the per-user daemon to be running.
- Displaying native notifications from a privileged machine service or Windows
  Session 0. Native notification delivery belongs to the logged-in user
  session.
- Automatically subscribing to every configured synchronization peer.
- Synchronizing notification state, users, permissions, API keys, or inbox
  rows between Servers.
- Executing HTML, JavaScript, arbitrary URL schemes, or notification-provided
  commands when a notification is displayed or clicked.
- Migrating or deleting legacy Tauri Desktop, Rust CLI, MiniServer, or local
  Server data.

## Product and Package Boundary

### Public package

The publishable package is named `localapp`:

```bash
npm install --global localapp
localapp server
```

`npx localapp ...` and a project-local `devDependency` are also supported. The
package declares Node.js 24 or newer and publishes one public binary named
`localapp`.

The repository may keep focused workspace packages such as Server Core and the
SDKs for source-code ownership and tests. They are build inputs, not additional
software an end user must select or install. The packed `localapp` artifact is
self-contained and resolves no `workspace:*`, repository-relative, or Rust
runtime dependency.

The package contains:

- The TypeScript CLI bundled to executable JavaScript.
- The canonical Server supervisor and worker bundles.
- The static Web control-plane build.
- Device Action runner assets.
- The staged builtin application template and SDK/runtime files copied by
  `localapp init`.
- Native adapter assets for supported release targets.
- A release manifest containing every file digest, package version, protocol
  versions, Node floor, and native-adapter target list.

The package does not run privileged or persistent installation work from npm's
`postinstall`. `localapp server` performs idempotent per-user registration,
starts the daemon, waits for readiness, and returns. This remains a one-package
installation while avoiding npm lifecycle-script policy and CI surprises.

### CLI surface

The supported public command groups are:

```text
localapp server [start]
localapp server stop|restart|status|logs|uninstall
localapp server run [--data-dir ... --host ... --port ...]

localapp init [name]
localapp dev
localapp check [--json]
localapp build --package [--output ...]

localapp login [server-url] [--profile ...]
localapp logout [--profile ...]
localapp whoami [--profile ...]

localapp app install [--target ...] [--package ...]
localapp app sync --peer ... [--target ...]
localapp app sync --peer ... --with-data --confirm-app ... [--target ...]
```

Server administration, users, permissions, peers, notification settings,
workspaces, tasks, application rollback, backups, and data replacement remain
available in the Web control plane. Narrow internal commands used by a service
manager or Scheme adapter are prefixed with `_` and are not a compatibility
surface.

The old Rust-only CRUD/admin convenience commands are removed rather than
reimplemented when the same operation is already available in Web. Commands
required by generated-project scripts are ported before the Rust binary is
deleted.

### TypeScript application toolchain

`localapp init`, `check`, `build`, `dev`, and `app install` are TypeScript
implementations shipped inside the same package. They preserve the canonical
`.localapp` archive contract:

- `manifest.json` normalized to package-relative roots.
- Built static files under `dist/`.
- Ordered SQL migrations under `migrations/`.
- Backend resources and contract files under `backend/`.
- Deterministic metadata and SHA-256 digests.
- No database, upload, user, permission, session, API Key, or platform data.

`localapp dev` continues to start a disposable canonical Server below
`<project>/tmp/localapp-dev/server`, install a uniquely versioned package
through `/api/me/apps/install`, and run Vite as a compiler and safe proxy. It
does not use the user's persistent daemon data and does not start another
backend implementation.

## Daemon Model

### Per-user service

Interactive installations run in the logged-in operating-system user's
session:

- macOS: a LaunchAgent.
- Windows: a current-user startup/scheduled task, not a Windows system service.
- Linux: a `systemd --user` service, with an explicitly reported foreground
  fallback when the user service manager is unavailable.

The service manager executes a stable launcher installed in LocalApp's
per-user support directory. The launcher resolves the current packed runtime,
so npm upgrades can atomically replace the active version without embedding a
temporary npm cache path in operating-system registration.

Default durable roots are:

- macOS: `~/Library/Application Support/LocalApp/`
- Windows: `%LOCALAPPDATA%\LocalApp\`
- Linux: `${XDG_DATA_HOME:-~/.local/share}/localapp/`

Runtime sockets, locks, and transient activation files use the platform runtime
directory, not the durable data root. Explicit `--data-dir` remains supported
for foreground/headless deployment and tests. No legacy local directory is
discovered or imported automatically.

### Supervisor and process ownership

The per-user daemon owns:

1. The canonical Server worker.
2. The local activation broker.
3. The notification connection manager and native-notification dispatcher.
4. Readiness, restart, shutdown, structured logs, and stale-process recovery.

Only one daemon may own a data root. A lock includes the process identity and a
random boot identifier; stale locks are reclaimed only after the recorded
process and control endpoint are both proven absent.

The daemon and adapter communicate through a user-private Unix-domain socket
or Windows named pipe. The endpoint is created with current-user-only access.
The canonical Server's existing loopback device-control endpoint retains an
in-memory per-boot secret; only the daemon broker knows that secret.

`localapp server stop` requests graceful shutdown, waits for the Server worker
and its descendants, then escalates within a bounded timeout. `status` verifies
the control endpoint and Server readiness rather than trusting a PID file.

## Native Adapter Boundary

The release includes the smallest platform-specific adapter necessary for
reliable Scheme and notification integration:

- macOS: a signed, windowless `.app` bundle using LaunchServices and
  `UserNotifications`. It handles `application:openURLs:`, notification
  permission, local notification delivery, and notification responses.
- Windows: a signed, windowless helper registered per user for the URI scheme
  and unpackaged App Notification activation.
- Linux: a per-user `.desktop` Scheme handler plus the freedesktop D-Bus
  notification interface. When a desktop notification server does not expose
  actions, clicking is unavailable and Web inbox access remains the fallback.

All adapter assets are selected by exact `process.platform` and
`process.arch`. An unsupported target fails with an actionable message; it
never silently installs a mismatched binary.

The adapter accepts a strict, length-bounded command envelope from the daemon
and returns structured JSON. It cannot read Server master keys, peer API Keys,
application databases, or action scripts. A notification envelope contains
only a local activation token, title, body, source label, priority, and a local
icon path.

## `localapp://` Activation

### Device Actions

The existing Device Action contract remains unchanged in meaning. The Scheme
URL contains only protocol version, canonical source origin, action ID, and a
high-entropy one-time nonce. It never contains the script, dependencies,
cookies, API Keys, or action input.

Scheme activation is required only when the source application is hosted by a
different Server. When a daemon-managed Server is listening on loopback and
hosts the application that creates the action, it is already the current
computer's execution authority. That Server claims the action through the same
private Device Control activation service before returning the creation
response. The response contains an exact same-origin confirmation URL instead
of a Scheme URL, and the SDK navigates to that page when first-use or expanded
permissions require trust. Existing trust may proceed directly to execution.

A Server is eligible for this local fast path only when it has a daemon-issued
Device Control token, has no non-loopback public URL, and its canonical source
origin is loopback. Application code never receives the control token and
cannot grant trust. Standalone, LAN, proxied, and remote Servers continue to
return `localapp://`; the computer whose operating system handles that Scheme
remains the execution target.

The platform adapter forwards the complete URL to the daemon's private IPC
endpoint. The daemon strictly parses and size-checks it, converts it to the
existing activation ticket, and forwards only that ticket to the canonical
Server's authenticated loopback control endpoint. The adapter may open only
the exact loopback confirmation URL returned by that endpoint.

If the daemon is not running, the adapter requests the per-user service manager
to start it and retries the private endpoint for a bounded interval. The action
always targets the computer whose operating system handled the Scheme.

### Notification activation

Notification clicks use:

```text
localapp://notification/open?ticket=<opaque-one-time-token>
```

The token maps to a local notification-source connection and source
notification ID. The Scheme URL contains no source API Key and no application
URL. The daemon consumes the token, loads the notification through its saved
source connection, verifies that the target is the source Server's same-origin
relative path, marks the notification read, and opens the formal
`/<owner>/<app>/...` page or the source inbox.

Duplicate, expired, malformed, oversized, or unknown tickets do nothing except
emit a bounded structured diagnostic. Notification activation never invokes a
Device Action or arbitrary executable.

## Notification Architecture

### Authoritative Server state

Every application notification is persisted in the source Server inbox before
any real-time or desktop delivery attempt. Displaying or dismissing a native
notification does not mark it read. A validated click or an explicit inbox
operation marks it read.

The source Server records two additional delivery properties for each new
notification:

- A monotonic per-database delivery sequence.
- Whether the user's subscription level and the notification priority made the
  event eligible for real-time delivery when it was created.

Existing rows receive no retroactive desktop-delivery eligibility during
migration. This prevents a newly enabled daemon from displaying an arbitrary
historical backlog or bypassing a previous mute decision.

### Real-time protocol

The authenticated `/api/ws` protocol is revised without changing the inbox's
role:

1. A daemon connects with a saved user API Key and its last committed delivery
   sequence.
2. The Server authenticates the user and sends `bus:ready` with protocol and
   current sequence information.
3. The daemon pages through a bounded delivery endpoint for eligible records
   after its cursor, oldest first.
4. Live `notify:notification` events include the delivery sequence.
5. The daemon displays and durably records each notification before advancing
   its source cursor.
6. Reconnect repeats the same query; notification ID plus source connection is
   the idempotency key.

The first time a source is enabled, its cursor starts at the source's current
sequence, so only future notifications pop up. Reconnection catches up at most
100 individual notifications from the previous 24 hours; any older or larger
backlog becomes one summary notification while every item remains in the Web
inbox.

Heartbeat, reconnect, and catch-up use bounded timeouts and exponential backoff
with jitter. One unavailable source cannot stop other sources or the local
Server.

### Notification sources and identity

Native notifications are configured per operating-system user and per LocalApp
account:

- A logged-in local account may explicitly enable “在这台电脑显示通知”.
- A verified remote peer account may be explicitly enabled as a notification
  source in Web settings.
- Merely creating a peer or synchronizing an application never enables its
  notifications.
- Disabling a source closes its WebSocket, removes its local cursor and pending
  click tickets, and leaves the source Server's inbox untouched.

Remote credentials remain encrypted with the local Server master key and are
never sent to Web pages, Scheme URLs, adapter arguments, notification bodies,
or logs. Multiple accounts may be enabled on one operating-system login, but
every native notification labels its Server and account so identities are not
silently mixed.

### Native display policy

The adapter receives only notifications already selected by the source
subscription policy (`all`, `important`, or `muted`). It preserves `normal` and
`high` priority but never bypasses operating-system Focus, Do Not Disturb, or
notification settings.

Native content is constrained to:

- Product name and safe local icon.
- Source Server/account label.
- Application name.
- Plain-text title and body with existing Server length limits.
- One default “open” action when supported.

HTML, Markdown rendering, remote images, scripts, arbitrary action buttons, and
publisher-provided sound paths are rejected. Rate limiting and grouping apply
per source application, and Web settings provide source enablement,
subscription level, quiet hours, preview visibility, and a test-notification
control.

macOS permission is requested only from the explicit Web enable/test action.
Permission states are `not-determined`, `granted`, `denied`, `unsupported`, or
`unknown`. A denied or unavailable adapter degrades to inbox-only behavior and
does not repeatedly prompt.

### Delivery failure behavior

- Source offline: reconnect later and continue from the committed cursor.
- Local adapter failure: retain the cursor before the failed item, retry within
  bounds, then emit one diagnostic and leave the record in the inbox.
- Daemon stopped: the login service restarts it; catch-up resumes afterward.
- OS user logged out: no popup is promised, but source inbox records remain.
- Permission denied: source connections may remain active for unread counts,
  but no native display is attempted.
- Click after credential removal: open the source Server login/inbox URL without
  marking the record read.

APNs/WNS cloud delivery can be added later as another transport into the same
inbox/cursor model. It is not required for the daemon-backed first release.

## Web Control Plane

The Server-hosted Web application adds a Device Notifications section that
shows:

- Whether this Server is running with local-device integration.
- Daemon and native-adapter versions.
- Operating-system permission state.
- Enabled local accounts and explicitly enabled remote sources.
- Connection health, last event, committed cursor, and last delivery error.
- Quiet hours and preview visibility.
- “发送测试通知”, enable, disable, and permission-help controls.

The browser never connects directly to the native adapter and never receives
the private daemon endpoint. Web mutations call authenticated same-origin
Server APIs; the Server updates durable configuration and signals the local
notification manager.

A public/headless Server exposes the same pages and APIs but reports local
device integration as unavailable. This is a deployment capability, not a
different Server implementation.

## Removal and Migration Policy

After the TypeScript CLI, package, Scheme, notification, and two-application
acceptance suites pass:

- Delete `packages/desktop` and all Tauri configuration and Rust Desktop code.
- Delete the full Rust `packages/cli` binary.
- Delete Rust-only template/package crates after their behavior is represented
  by TypeScript tests.
- Remove Desktop and Rust CLI release scripts, workflow inputs, documentation,
  and generated-artifact checks.
- Rename the publishable Server package to `localapp` and publish only its
  unified `localapp` binary.

No compatibility launcher, local-data migration, import wizard, ownership
mapping, or automatic deletion is provided. A user may point a foreground
Server at an explicitly chosen existing remote/headless data directory, but
the package never discovers legacy local data on its own.

## Testing Strategy

### Package and CLI

- Pack `localapp-<version>.tgz`, install it into a clean repository-owned
  prefix, and prove the `localapp` binary has no repository or Rust dependency.
- Initialize a builtin application, install dependencies, run `check`, build a
  deterministic `.localapp` archive, install it, and open its formal route.
- Run `localapp dev` with all generated Server data below the application's
  `tmp/` directory and verify process-tree cleanup.
- Verify daemon start/status/restart/stop/uninstall and stale-lock recovery.

### Scheme and native adapter

- Contract-test strict Device Action and notification URL parsing, IPC framing,
  length limits, one-time tickets, source validation, and safe open targets.
- Package-test that the exact current-platform adapter is selected and every
  unsupported or mismatched target fails closed.
- On macOS local acceptance, install the generated app bundle, verify
  LaunchServices registration, activate a real `localapp://` URL, and observe
  the daemon/server result.
- Equivalent release jobs exercise Windows current-user registration and Linux
  `.desktop`/D-Bus integration.

### Notifications

- Unit-test cursor ordering, first-enable baseline, deduplication, retry,
  backlog summarization, source isolation, mute/high-priority routing, and safe
  click targets.
- Integration-test local and remote Server sources, WebSocket reconnect,
  credential removal, adapter failure, permission denial, and read-on-click.
- Display a real local test notification, inspect the operating-system result,
  activate its click URL, and verify that the formal Web destination opens.

### Product acceptance

- Use `browser:control-in-app-browser` against loopback formal routes.
- In the SKILL marketplace, click install in Web, traverse the real
  `localapp://` Device Action path on the same computer, approve trust, and
  verify the fixture SKILL appears below repository `tmp/`.
- In resume manager, upload, preview, and byte-verify downloads for an image and
  PDF through the packaged Server.
- Trigger an application notification, observe it in the Server inbox and as a
  native popup, click it, and verify the correct application route and read
  state.

## Acceptance Criteria

- `npm install --global localapp` is the only product installation required.
- The installed package exposes one `localapp` binary and requires no Rust,
  Tauri, Electron, or second Server package at runtime.
- `localapp server` idempotently installs and starts a per-user daemon; the same
  package runs in the foreground with `localapp server run`.
- Local and remote deployments execute the same canonical Server worker and Web
  build.
- There is no tray, window, WebView, Desktop backend, MiniServer, or special
  local user.
- `localapp://` Device Action activation works on the computer where the user
  clicked and transfers no script or credential in the URL.
- The daemon receives eligible local and explicitly enabled remote
  notifications, reconnects by cursor without duplicates, and displays native
  notifications when OS permission allows.
- Notification clicks use a one-time local ticket, open only a validated source
  route, and mark only the authenticated source notification read.
- Muted notifications never reappear as catch-up popups; inbox records remain
  available regardless of desktop delivery.
- The packed npm artifact initializes, checks, builds, installs, and develops a
  builtin application using only files below the repository during acceptance.
- The SKILL marketplace and resume-manager journeys pass through their formal
  packaged-Server routes, and the notification journey passes through a real
  native adapter.
- Legacy Desktop/Rust/local data are neither imported nor deleted
  automatically.

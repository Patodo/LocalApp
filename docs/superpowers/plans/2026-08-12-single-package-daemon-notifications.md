# Single Package, User Daemon, Scheme, and Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish one installable `localapp` npm package that provides the TypeScript application CLI, canonical Server, per-user daemon, `localapp://` bridge, and native desktop notifications, then remove the replaced Rust CLI and Tauri Desktop after local product acceptance passes.

**Architecture:** A new `packages/localapp` workspace is the sole publishable product package. It bundles focused internal workspace code, the canonical Server worker, Web assets, builtin template, and platform adapters into one npm tarball. Personal computers run the package as a per-user daemon with private IPC for Scheme activation and notification clicks; headless deployments run the same Server worker in the foreground. Source Server inbox rows remain authoritative and a cursor-based delivery protocol feeds an injected native notification adapter.

**Tech Stack:** Node.js 24, TypeScript, esbuild, Fastify, sql.js, ws, pnpm, Vitest, Node test runner, macOS Swift/UserNotifications, Windows native App Notifications helper, Linux freedesktop D-Bus notifications, LaunchAgent/current-user scheduled task/systemd user service.

## Global Constraints

- Work directly on `main`; do not create a branch or worktree.
- Use TDD for every production behavior: write one behavior test, observe the expected failure, implement the minimum, and rerun before refactoring.
- The public product install is one npm package named `localapp` with one public binary named `localapp`.
- Node.js 24 or newer is required; Rust, Tauri, Electron, and a separately installed Server package are not runtime requirements.
- There is one canonical Server implementation and one complete multi-user authentication/permission model in every deployment.
- `localapp server` means `localapp server start`; `localapp server run` is the foreground/headless entrypoint.
- No tray, menu-bar item, main window, WebView, or Desktop management UI may remain.
- `localapp://` remains mandatory and always acts on the computer whose operating system handled the URL.
- Scheme URLs never contain scripts, API Keys, cookies, notification target URLs, or application input.
- Native notification delivery is a hint; the source Server inbox is authoritative.
- A remote peer is never a notification source until a local user explicitly enables it.
- Muted notifications never become reconnect/catch-up popups.
- Legacy Desktop, Rust CLI, MiniServer, and local Server data are neither imported nor deleted automatically.
- Generated projects, Server data, uploads, downloads, npm prefixes, packages, sockets used by acceptance, and installed SKILL fixtures stay below `/Volumes/patodo-disk/p-github/LocalApp/tmp/`.
- Formal application acceptance uses `/<owner>/<app>/`; `/serve/<owner>/<app>/` is diagnostic only.
- Browser acceptance uses `browser:control-in-app-browser` against loopback URLs.

---

### Task 1: Create the sole publishable `localapp` package and command dispatcher

**Files:**
- Create: `packages/localapp/package.json`
- Create: `packages/localapp/tsconfig.json`
- Create: `packages/localapp/vitest.config.ts`
- Create: `packages/localapp/src/main.ts`
- Create: `packages/localapp/src/cli/args.ts`
- Create: `packages/localapp/src/cli/output.ts`
- Create: `packages/localapp/scripts/build-package.mjs`
- Create: `packages/localapp/scripts/build-package.node-test.mjs`
- Modify: `package.json`
- Modify: `pnpm-workspace.yaml`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Produces: `runLocalApp(argv: string[], io?: CliIo): Promise<number>`.
- Produces: `parseLocalAppArgs(argv: string[]): LocalAppCommand` with explicit discriminated command variants.
- Produces: `buildLocalAppPackage({ outputDirectory }): Promise<{ outputDirectory: string; tarballInput: string; manifestPath: string }>`.
- Consumes: no Rust binary and no Server process in this task.

- [x] **Step 1: Write the failing package and parser tests**

```ts
test("packed product exposes one localapp binary without workspace references", async () => {
  const result = await buildLocalAppPackage({ outputDirectory });
  const manifest = JSON.parse(await fs.readFile(path.join(result.outputDirectory, "package.json"), "utf8"));
  assert.equal(manifest.name, "localapp");
  assert.deepEqual(manifest.bin, { localapp: "bin/localapp.mjs" });
  assert.equal(JSON.stringify(manifest).includes("workspace:"), false);
  assert.equal(await run(result.outputDirectory, ["--version"]), "localapp 0.1.0");
});

it("parses server as the start alias and keeps foreground run distinct", () => {
  expect(parseLocalAppArgs(["server"])).toEqual({ kind: "server-start" });
  expect(parseLocalAppArgs(["server", "run", "--port", "0"])).toEqual({ kind: "server-run", port: 0 });
});
```

- [x] **Step 2: Run the tests and verify RED**

Run: `pnpm -C packages/localapp test && node --test packages/localapp/scripts/build-package.node-test.mjs`

Expected: FAIL because the workspace package, dispatcher, and package builder do not exist.

- [x] **Step 3: Implement the minimum package and dispatcher**

Use this public command contract:

```ts
export type LocalAppCommand =
  | { kind: "help" }
  | { kind: "version" }
  | { kind: "server-start" }
  | { kind: "server-run"; dataDir?: string; host?: string; port?: number }
  | { kind: "server-control"; action: "stop" | "restart" | "status" | "logs" | "uninstall" }
  | { kind: "init"; name?: string; skipInstall: boolean; skipDeploy: boolean }
  | { kind: "check"; json: boolean; profile?: string }
  | { kind: "build-package"; output?: string }
  | { kind: "login"; serverUrl?: string; apiKey?: string; profile?: string }
  | { kind: "logout"; profile?: string }
  | { kind: "whoami"; profile?: string }
  | { kind: "app-install"; target?: string; packagePath?: string }
  | { kind: "app-sync"; target?: string; peer: string; withData: boolean; confirmation?: string }
  | { kind: "dev" }
  | { kind: "sync-template"; quiet: boolean }
  | { kind: "eject-template" };
```

Rename the root private importer to `localapp-workspace`, add
`packages/localapp` to pnpm, and make `build-package.mjs` emit a minimal
Node-24 package with `bin/localapp.mjs`, bundled CLI code, and
`.localapp-artifact.json`. Unknown options return structured stderr and exit 1.

- [x] **Step 4: Run package tests and workspace install**

Run: `pnpm install --lockfile-only && pnpm -C packages/localapp test && node --test packages/localapp/scripts/build-package.node-test.mjs`

Expected: PASS; the generated manifest has one public binary and no workspace references.

- [x] **Step 5: Commit the package skeleton**

```bash
git add package.json pnpm-workspace.yaml pnpm-lock.yaml packages/localapp
git commit -m "feat(package): add unified localapp npm package"
```

### Task 2: Port profiles, authenticated HTTP, login, logout, and whoami to TypeScript

**Files:**
- Create: `packages/localapp/src/config/paths.ts`
- Create: `packages/localapp/src/config/profile-store.ts`
- Create: `packages/localapp/src/http/localapp-client.ts`
- Create: `packages/localapp/src/commands/login.ts`
- Create: `packages/localapp/src/commands/logout.ts`
- Create: `packages/localapp/src/commands/whoami.ts`
- Create: `packages/localapp/tests/profile-store.test.ts`
- Create: `packages/localapp/tests/localapp-client.test.ts`
- Create: `packages/localapp/tests/login.test.ts`
- Modify: `packages/localapp/src/main.ts`

**Interfaces:**
- Produces: `ProfileStore.load(configDir?: string): Promise<ProfileDocument>` and atomic `save`/`resolve` operations.
- Produces: `ServerProfile = { name: string; serverUrl: string; apiKey: string }`.
- Produces: `LocalAppClient.requestJson`, `getJson`, `postJson`, `installPackage` with redirects disabled.
- Consumes: `CliIo` from Task 1.

- [x] **Step 1: Write failing profile and HTTP boundary tests**

```ts
it("writes profiles atomically with user-only POSIX permissions", async () => {
  const store = new ProfileStore(configDir);
  await store.upsert({ name: "office", serverUrl: "https://office.example", apiKey: "secret" });
  expect((await fs.stat(path.join(configDir, "profiles.json"))).mode & 0o777).toBe(0o600);
  expect((await store.resolve("office")).apiKey).toBe("secret");
});

it("never forwards an API Key across a redirect", async () => {
  const result = await client.getJson("/api/me");
  expect(result.ok).toBe(false);
  expect(externalObservedApiKey).toBe(false);
});

it("validates login through api/me before saving the profile", async () => {
  const code = await runLocalApp(["login", serverUrl, "--api-key", apiKey, "--profile", "local"], io);
  expect(code).toBe(0);
  expect((await store.resolve("local")).serverUrl).toBe(serverUrl);
});
```

- [x] **Step 2: Run targeted tests and verify RED**

Run: `pnpm -C packages/localapp exec vitest run tests/profile-store.test.ts tests/localapp-client.test.ts tests/login.test.ts`

Expected: FAIL because the TypeScript profile store and authenticated client do not exist.

- [x] **Step 3: Implement secure profiles and HTTP commands**

Normalize profiles to HTTP(S) origins with no credentials or fragments. Use
`LOCALAPP_CONFIG_DIR` when set; otherwise use the platform user config root.
Publish writes with a same-directory temporary file, `fsync`, rename, and mode
`0600` on POSIX. The client uses `redirect: "manual"`, 10-second login and
30-second ordinary timeouts, `X-API-Key`, and the packed product version.
`login` validates `/api/me`; `logout` removes only the selected credential;
`whoami` prints the authenticated envelope.

- [x] **Step 4: Run targeted and Server authentication tests**

Run: `pnpm -C packages/localapp test && pnpm -C packages/server exec vitest run tests/integration/auth.test.ts tests/integration/global-auth.test.ts`

Expected: PASS with no API Key in stdout, stderr, redirect targets, or snapshots.

- [x] **Step 5: Commit TypeScript authentication**

```bash
git add packages/localapp
git commit -m "feat(cli): port profiles and authentication to TypeScript"
```

### Task 3: Stage the builtin template and port init, sync, and eject

**Files:**
- Create: `packages/localapp/src/template/stage.ts`
- Create: `packages/localapp/src/template/copy.ts`
- Create: `packages/localapp/src/template/package-json.ts`
- Create: `packages/localapp/src/project/manifest.ts`
- Create: `packages/localapp/src/commands/init.ts`
- Create: `packages/localapp/src/commands/sync-template.ts`
- Create: `packages/localapp/src/commands/eject-template.ts`
- Create: `packages/localapp/scripts/stage-template.mjs`
- Create: `packages/localapp/tests/init.test.ts`
- Create: `packages/localapp/tests/template-zones.test.ts`
- Modify: `packages/localapp/scripts/build-package.mjs`
- Modify: `packages/localapp/src/main.ts`
- Modify: `init-repo/package.json`

**Interfaces:**
- Produces: `stageBuiltinTemplate({ repositoryRoot, outputDirectory, version }): Promise<void>`.
- Produces: `initializeProject({ cwd, name, description, skipInstall, skipDeploy, io }): Promise<InitResult>`.
- Produces: `syncManagedTemplate(projectDir, { quiet }): Promise<SyncResult>`.
- Consumes: SDK, backend, Server Core build outputs and `init-repo` source.

- [x] **Step 1: Write failing real-template extraction tests**

```ts
it("initializes a complete builtin project from the packed template", async () => {
  const result = await initializeProject({ cwd: workspace, name: "fresh-app", skipInstall: true, skipDeploy: true, io });
  expect(result.projectDir).toBe(path.join(workspace, "fresh-app"));
  expect(JSON.parse(await read("fresh-app/manifest.json")).name).toBe("fresh-app");
  expect(await exists("fresh-app/.localapp/runtime/server-core/dist/index.js")).toBe(true);
  expect(await exists("fresh-app/.claude/skills/localapp/SKILL.md")).toBe(true);
});

it("sync replaces managed files without changing user source", async () => {
  await fs.writeFile(path.join(project, "src/App.tsx"), "user-owned\n");
  await syncManagedTemplate(project, { quiet: true });
  expect(await fs.readFile(path.join(project, "src/App.tsx"), "utf8")).toBe("user-owned\n");
  expect(JSON.parse(await fs.readFile(path.join(project, ".localapp/runtime/version.json"), "utf8")).cliVersion).toBe(version);
});
```

- [x] **Step 2: Run template tests and verify RED**

Run: `pnpm -C packages/server-core build && pnpm -C packages/localapp exec vitest run tests/init.test.ts tests/template-zones.test.ts`

Expected: FAIL because no staged npm-package template or TypeScript init exists.

- [x] **Step 3: Implement deterministic staging and project commands**

Stage `init-repo` without `node_modules`, `dist`, `.next`, and generated data;
inject SDK/backend source and Server Core dist under `runtime/`; write the
package version marker; and copy only user-zone files plus managed runtime and
LocalApp skills. Postprocess `workspace:*` dependencies into
`.localapp/runtime` file dependencies. `sync` updates only the managed zone.
`eject` copies managed files into user ownership, writes the monotonic ejected
marker, and refuses every later automatic sync.

- [x] **Step 4: Run template, init, and generated-project tests**

Run: `pnpm -C packages/localapp test && pnpm -C init-repo test && pnpm -C init-repo build`

Expected: PASS; generated files are complete and user source remains unchanged by sync.

- [x] **Step 5: Commit the TypeScript template lifecycle**

```bash
git add packages/localapp init-repo/package.json
git commit -m "feat(cli): port builtin template lifecycle"
```

### Task 4: Port project checks and deterministic `.localapp` package creation

**Files:**
- Create: `packages/localapp/src/project/files.ts`
- Create: `packages/localapp/src/project/backend.ts`
- Create: `packages/localapp/src/project/check.ts`
- Create: `packages/localapp/src/project/package.ts`
- Create: `packages/localapp/src/commands/check.ts`
- Create: `packages/localapp/src/commands/build.ts`
- Create: `packages/localapp/tests/check.test.ts`
- Create: `packages/localapp/tests/package.test.ts`
- Modify: `packages/server/src/index.ts`
- Modify: `packages/localapp/src/main.ts`
- Modify: `packages/localapp/package.json`

**Interfaces:**
- Produces: `checkProject(options): Promise<CheckReport>` with project, capabilities, migrations, backend, tests, build, and dist phases.
- Produces: `buildApplicationPackage(options): Promise<{ path: string; appId: string; version: string; sha256: string; size: number }>`.
- Consumes: `writeAppPackage`, `inspectAppPackage`, `validateMigrationFilenames`, and `validateBackendContract`.

- [x] **Step 1: Write failing package-contract tests**

```ts
it("builds byte-identical canonical packages", async () => {
  const first = await buildApplicationPackage({ projectDir, outputPath: path.join(root, "a.localapp") });
  const second = await buildApplicationPackage({ projectDir, outputPath: path.join(root, "b.localapp") });
  expect(first.sha256).toBe(second.sha256);
  const inspected = await inspectAppPackage(first.path);
  expect(inspected.entries.map((entry) => entry.path)).toEqual([
    "backend/resources/items/mutations.json",
    "backend/resources/items/queries.json",
    "backend/resources/items/schema.json",
    "dist/index.html",
    "manifest.json",
    "migrations/001_items.sql",
  ]);
});

it("stops check after a failing test phase and never packages stale dist", async () => {
  const report = await checkProject({ projectDir, run: fakeRunWithFailingTests });
  expect(report.success).toBe(false);
  expect(report.failedPhase).toBe("tests");
  expect(report.phases.find((phase) => phase.phase === "build")?.status).toBe("not-run");
});
```

- [x] **Step 2: Run project tests and verify RED**

Run: `pnpm -C packages/localapp exec vitest run tests/check.test.ts tests/package.test.ts`

Expected: FAIL because TypeScript project checks and package collection do not exist.

- [x] **Step 3: Implement checks and canonical collection**

Export the existing Server package writer/inspector through an internal build
entry consumed by esbuild. Validate the manifest, platform range, migration
filenames, Named SQL backend contract, declared content capabilities, and
package-safe paths. Run project `test` then `build` scripts with the detected
package manager. Normalize `distDir` to `dist` and backend root to `backend`
inside the archive. Sort every file and use fixed archive timestamps.

- [x] **Step 4: Run package compatibility and real-app builds**

Run: `pnpm -C packages/localapp test && pnpm -C packages/server exec vitest run tests/integration/app-package-install.test.ts && pnpm run build:real-apps`

Expected: PASS; TypeScript output is accepted by the unchanged canonical installer.

- [x] **Step 5: Commit TypeScript checks and packaging**

```bash
git add packages/localapp packages/server/src/index.ts
git commit -m "feat(cli): port checks and application packaging"
```

### Task 5: Port application install and peer synchronization

**Files:**
- Create: `packages/localapp/src/commands/app-install.ts`
- Create: `packages/localapp/src/commands/app-sync.ts`
- Create: `packages/localapp/src/project/target.ts`
- Create: `packages/localapp/tests/app-install.test.ts`
- Create: `packages/localapp/tests/app-sync.test.ts`
- Modify: `packages/localapp/src/http/localapp-client.ts`
- Modify: `packages/localapp/src/main.ts`

**Interfaces:**
- Produces: `installApplication({ projectDir, target, packagePath }): Promise<InstallResult>`.
- Produces: `syncApplication({ projectDir, target, peer, withData, confirmation }): Promise<SyncJob>`.
- Consumes: Task 2 profiles and Task 4 package builder.

- [x] **Step 1: Write failing real-Server command tests**

```ts
it("builds and installs the current project into the selected Server", async () => {
  const result = await installApplication({ projectDir, target: "local" });
  expect(result.serverUrl).toBe(serverUrl);
  expect(result.data.app.name).toBe("install-fixture");
  expect((await fetch(`${serverUrl}/${owner}/install-fixture/`)).status).toBe(200);
});

it("requires an exact app-name confirmation before data sync", async () => {
  await expect(syncApplication({ projectDir, target: "source", peer: "target", withData: true, confirmation: "wrong" }))
    .rejects.toThrow("--confirm-app install-fixture");
});
```

- [x] **Step 2: Run command tests and verify RED**

Run: `pnpm -C packages/localapp exec vitest run tests/app-install.test.ts tests/app-sync.test.ts`

Expected: FAIL because the TypeScript install and sync commands do not exist.

- [x] **Step 3: Implement install and synchronization polling**

Use Node `FormData`/`Blob` to upload the inspected package to
`/api/me/apps/install`. Resolve target precedence as explicit profile, project
`.localapp/publish.json`, then current profile. Start sync through
`/api/me/apps/:name/sync`, poll `/api/sync-jobs/:id` every 250 ms, return only
on `completed`, and preserve `rolled-back`, `failed`, and `recovery-required`
as structured failures.

- [x] **Step 4: Run install, two-peer, and data-sync suites**

Run: `pnpm -C packages/localapp test && pnpm -C packages/server exec vitest run tests/integration/two-peer-sync.test.ts tests/integration/two-peer-data-sync.test.ts`

Expected: PASS; target ownership, idempotency, data preservation, replacement, and rollback remain unchanged.

- [x] **Step 5: Commit TypeScript publishing**

```bash
git add packages/localapp
git commit -m "feat(cli): port application install and synchronization"
```

### Task 6: Port canonical local development and process-tree supervision

**Files:**
- Create: `packages/localapp/src/commands/dev.ts`
- Create: `packages/localapp/src/process/process-tree.ts`
- Create: `packages/localapp/src/process/readiness.ts`
- Create: `packages/localapp/src/dev/credentials.ts`
- Create: `packages/localapp/tests/dev.test.ts`
- Create: `packages/localapp/tests/process-tree.test.ts`
- Replace: `packages/server/scripts/localapp-dev-package.node-test.mjs`
- Modify: `packages/localapp/src/main.ts`
- Modify: `packages/localapp/scripts/build-package.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `runDev({ projectDir, signal, io }): Promise<number>`.
- Produces: `spawnOwnedProcess(command, args, options): OwnedProcess` with bounded `terminate()`.
- Consumes: Task 4 package builder and the existing canonical Server package builder.

- [x] **Step 1: Write failing packaged-dev and stubborn-descendant tests**

```ts
it("keeps all dev state below the project tmp directory", async () => {
  const running = await startDev(appDirectory);
  expect(running.serverDataDir).toBe(path.join(appDirectory, "tmp/localapp-dev/server"));
  expect((await fetch(new URL("api/me", running.appUrl))).status).toBe(200);
  await running.stop();
  expect(await allProcessesGone(running.processIds)).toBe(true);
});

it("terminates a descendant that ignores SIGTERM", async () => {
  const owned = await spawnStubbornFixture();
  await owned.terminate();
  expect(await processExists(owned.grandchildPid)).toBe(false);
});
```

- [x] **Step 2: Run dev tests and verify RED**

Run: `pnpm -C packages/localapp exec vitest run tests/dev.test.ts tests/process-tree.test.ts && pnpm test:local-dev-package`

Expected: FAIL because the packaged TypeScript CLI cannot yet supervise canonical Server plus Vite.

- [x] **Step 3: Implement the Node development supervisor**

Generate stable CSPRNG local credentials in private files, launch the packaged
Server on strict `127.0.0.1:0` with dev tools, wait at most 15 seconds for its
structured ready event, build/install a unique dev package, write only the
documented fields to `.localapp/dev-config.json`, then launch `dev:vite` on
loopback. Unix uses a detached process group. Windows delegates atomic
suspended-root Job Object assignment to the Task 8 native adapter. Either
child exit or interrupt terminates and waits for both complete trees. Extend the
unified package builder to embed the canonical Server `bin`, worker, Web assets,
runner, and sql.js runtime under `runtime/server/`; the CLI launches that exact
embedded worker and never resolves a separate `localapp-server` installation.

- [x] **Step 4: Run packaged development and proxy security suites**

Run: `pnpm test:local-dev-package && pnpm -C packages/server exec vitest run tests/integration/dev-routes.test.ts tests/process-tree.test.ts`

Expected: PASS; app, Server, proxy, reset/snapshot, CSRF, and descendant cleanup all succeed.

- [x] **Step 5: Commit TypeScript local development**

```bash
git add packages/localapp packages/server/scripts/localapp-dev-package.node-test.mjs package.json
git commit -m "feat(cli): port canonical local development"
```

### Task 7: Add the per-user daemon, private IPC, and service lifecycle

**Files:**
- Create: `packages/localapp/src/daemon/daemon.ts`
- Create: `packages/localapp/src/daemon/control-protocol.ts`
- Create: `packages/localapp/src/daemon/ipc-server.ts`
- Create: `packages/localapp/src/daemon/ipc-client.ts`
- Create: `packages/localapp/src/daemon/runtime-layout.ts`
- Create: `packages/localapp/src/daemon/release-store.ts`
- Create: `packages/localapp/src/service/service-manager.ts`
- Create: `packages/localapp/src/service/macos-launch-agent.ts`
- Create: `packages/localapp/src/service/windows-user-task.ts`
- Create: `packages/localapp/src/service/linux-systemd-user.ts`
- Create: `packages/localapp/src/commands/server.ts`
- Create: `packages/localapp/tests/control-protocol.test.ts`
- Create: `packages/localapp/tests/daemon-lifecycle.test.ts`
- Create: `packages/localapp/tests/service-manager.test.ts`
- Modify: `packages/localapp/src/main.ts`
- Modify: `packages/localapp/scripts/build-package.mjs`

**Interfaces:**
- Produces: `DaemonControlRequest`/`DaemonControlResponse`, each newline-delimited and capped at 64 KiB.
- Produces: `runDaemon(options): Promise<never>`.
- Produces: `ServiceManager.install/start/stop/status/uninstall`.
- Produces: `RuntimeLayout` with data, runtime, socket/pipe, log, lock, and release paths.
- Consumes: canonical Server worker and an in-memory device-control token.

- [x] **Step 1: Write failing lifecycle, lock, and IPC tests**

```ts
it("server start installs once and returns only after daemon readiness", async () => {
  await serverStart({ serviceManager, releaseStore, timeoutMs: 15_000 });
  await serverStart({ serviceManager, releaseStore, timeoutMs: 15_000 });
  expect(serviceManager.installCalls).toBe(1);
  expect((await queryDaemon()).server.status).toBe("ready");
});

it("rejects oversized and unknown private control messages", async () => {
  expect((await sendRaw(Buffer.alloc(65 * 1024))).code).toBe("IPC_MESSAGE_TOO_LARGE");
  expect((await sendJson({ type: "shell" })).code).toBe("IPC_REQUEST_UNSUPPORTED");
});
```

- [x] **Step 2: Run daemon tests and verify RED**

Run: `pnpm -C packages/localapp exec vitest run tests/control-protocol.test.ts tests/daemon-lifecycle.test.ts tests/service-manager.test.ts`

Expected: FAIL because no per-user release store, service manager, or daemon control endpoint exists.

- [x] **Step 3: Implement idempotent user-service supervision**

Copy the packed runtime atomically to
`<support>/releases/<version>-<artifactDigest>`, publish `current.json`, and
register a stable bootstrap launcher. Use LaunchAgent, a current-user Windows
task, or `systemd --user`; never install a privileged service. Create a
current-user-only Unix socket or named pipe. Verify status through IPC plus
Server `/health`, not PID alone. Rotate the Server device-control token every
daemon boot and keep it in memory.

- [x] **Step 4: Run lifecycle integration on the current platform**

Run: `pnpm -C packages/localapp test && node --test packages/localapp/scripts/build-package.node-test.mjs`

Expected: PASS; start/status/restart/stop/uninstall are idempotent and no process survives uninstall in the test runtime root.

- [x] **Step 5: Commit the daemon lifecycle**

```bash
git add packages/localapp
git commit -m "feat(daemon): add per-user Server supervision"
```

### Task 8: Replace Tauri Scheme ownership with minimal platform adapters

**Files:**
- Create: `packages/localapp/src/native/native-adapter.ts`
- Create: `packages/localapp/src/native/adapter-selection.ts`
- Create: `packages/localapp/src/activation/activation-url.ts`
- Create: `packages/localapp/src/activation/activation-broker.ts`
- Create: `packages/localapp/native/macos/LocalAppBridge.swift`
- Create: `packages/localapp/native/macos/Info.plist`
- Create: `packages/localapp/native/windows/Cargo.toml`
- Create: `packages/localapp/native/windows/src/main.rs`
- Create: `packages/localapp/native/linux/localapp-handler.desktop`
- Create: `packages/localapp/scripts/build-native-adapter.mjs`
- Create: `packages/localapp/tests/adapter-selection.test.ts`
- Create: `packages/localapp/tests/activation-url.test.ts`
- Create: `packages/localapp/tests/activation-broker.test.ts`
- Create: `packages/localapp/scripts/native-adapter.node-test.mjs`
- Modify: `packages/localapp/src/daemon/control-protocol.ts`
- Modify: `packages/localapp/src/daemon/daemon.ts`
- Modify: `packages/localapp/scripts/build-package.mjs`

**Interfaces:**
- Produces: `NativeAdapter.installScheme`, `showNotification`, `permissionState`, and `requestPermission`.
- Produces: `parseActivationUrl(value): DeviceActionActivation | NotificationActivation`.
- Consumes: Task 7 private IPC and existing Server `/api/device-control/activations`.

- [x] **Step 1: Write failing strict activation and adapter-selection tests**

```ts
it("accepts only canonical Device Action and opaque notification activations", () => {
  expect(parseActivationUrl(validDeviceUrl).kind).toBe("device-action");
  expect(parseActivationUrl("localapp://notification/open?ticket=" + token).kind).toBe("notification");
  expect(() => parseActivationUrl("localapp://notification/open?ticket=x&url=https://evil.example"))
    .toThrow("ACTIVATION_URL_INVALID");
});

it("fails closed for an unshipped platform target", () => {
  expect(() => selectAdapter({ platform: "aix", arch: "ppc64" })).toThrow("NATIVE_ADAPTER_UNSUPPORTED");
});
```

- [x] **Step 2: Run activation tests and verify RED**

Run: `pnpm -C packages/localapp exec vitest run tests/adapter-selection.test.ts tests/activation-url.test.ts tests/activation-broker.test.ts && node --test packages/localapp/scripts/native-adapter.node-test.mjs`

Expected: FAIL because the strict broker and non-Tauri adapters do not exist.

- [x] **Step 3: Implement Scheme registration and broker forwarding**

The macOS app is windowless, registers `CFBundleURLTypes`, forwards
`application:openURLs:` to private IPC, and uses UserNotifications. The Windows
helper registers and forwards only the current-user URI Scheme handler in this
task; Windows App Notification display, activation registration, and callback
handling are explicitly deferred to Task 11. Its Rust usage is restricted to
this tiny native boundary and never contains CLI/Server business code. Linux
installs the per-user `.desktop` Scheme handler and invokes the Node IPC client;
Linux notification display remains unsupported until Task 11. The daemon
accepts only parsed tickets, calls the authenticated loopback activation route,
and opens only the exact loopback confirmation path returned by the ready
Server.

- [x] **Step 4: Build and activate the current-platform adapter**

Run: `pnpm -C packages/localapp run build:native && pnpm -C packages/localapp test:native`

Expected: PASS; a real `localapp://` fixture reaches the test daemon and malformed variants produce no browser or process launch.

- [x] **Step 5: Commit the minimal native boundary**

```bash
git add packages/localapp
git commit -m "feat(native): replace Tauri with Scheme adapters"
```

### Task 9: Make notification delivery durable, ordered, and mute-safe

**Files:**
- Create: `packages/server/src/lib/notification-delivery.ts`
- Create: `packages/server/tests/notification-delivery.test.ts`
- Create: `packages/server/tests/integration/notification-delivery-api.test.ts`
- Modify: `packages/server/src/lib/meta-sqlite.ts`
- Modify: `packages/server/src/lib/notifications-db.ts`
- Modify: `packages/server/src/routes/inbox.ts`
- Modify: `packages/server/src/routes/serve.ts`
- Modify: `packages/server/src/routes/ws.ts`
- Modify: `packages/server/src/lib/ws-manager.ts`
- Modify: `packages/server/tests/integration/ws-bus.test.ts`
- Modify: `packages/server/tests/integration/notify-routing.test.ts`

**Interfaces:**
- Produces: `DeliveryNotification` with `sequence`, `eligible`, source app, title/body/url/priority, and creation time.
- Produces: `listDeliverableNotifications(userId, { afterSequence, limit, since }): DeliveryPage`.
- Produces: authenticated `GET /api/inbox/delivery?afterSequence=&limit=&since=`.
- Extends: live `notify:notification` payload with `sequence`; `bus:ready` with protocol version and latest sequence.

- [x] **Step 1: Write failing ordering, migration, and mute tests**

```ts
it("returns eligible notifications oldest first after an exclusive cursor", () => {
  const page = listDeliverableNotifications(userId, { afterSequence: 10, limit: 2 });
  expect(page.items.map((item) => item.sequence)).toEqual([11, 12]);
  expect(page.nextSequence).toBe(12);
});

it("never catch-up delivers a notification muted when it was created", async () => {
  await setSubscription("muted");
  await createNotification({ priority: "high" });
  await setSubscription("all");
  expect((await deliveryAfter(0)).items).toEqual([]);
  expect((await inbox()).items).toHaveLength(1);
});
```

- [x] **Step 2: Run notification delivery tests and verify RED**

Run: `pnpm -C packages/server exec vitest run tests/notification-delivery.test.ts tests/integration/notification-delivery-api.test.ts tests/integration/notify-routing.test.ts`

Expected: FAIL because notifications have neither a monotonic sequence nor creation-time delivery eligibility.

- [x] **Step 3: Implement delivery metadata and protocol version 2**

Add nullable `delivery_seq` and `delivery_eligible` columns. Existing rows remain
ineligible. Allocate new sequences monotonically inside the single database
write queue, persist the routing decision before WebSocket send, and expose
only eligible rows through the new endpoint. Keep ordinary `/api/inbox`
unchanged. Live events and catch-up use the same serializer so their payloads
cannot diverge.

- [x] **Step 4: Run the complete inbox/notify/WebSocket suite**

Run: `pnpm -C packages/server exec vitest run tests/integration/inbox-api.test.ts tests/integration/notify-e2e-flow.test.ts tests/integration/notify-levels-integration.test.ts tests/integration/ws-bus.test.ts tests/ws-manager-desktop.test.ts`

Expected: PASS; old inbox behavior remains, live delivery is ordered, and mute cannot be bypassed by reconnect.

- [x] **Step 5: Commit durable notification delivery**

```bash
git add packages/server
git commit -m "feat(notify): add durable delivery cursors"
```

### Task 10: Add daemon notification sources, reconnect, deduplication, and click tickets

**Files:**
- Create: `packages/server/src/lib/device-notification-source-store.ts`
- Create: `packages/server/src/routes/device-notifications.ts`
- Create: `packages/server/tests/device-notification-source-store.test.ts`
- Create: `packages/server/tests/integration/device-notifications.test.ts`
- Create: `packages/localapp/src/notifications/source-connection.ts`
- Create: `packages/localapp/src/notifications/connection-manager.ts`
- Create: `packages/localapp/src/notifications/delivery-store.ts`
- Create: `packages/localapp/src/notifications/click-ticket-store.ts`
- Create: `packages/localapp/src/notifications/notification-dispatcher.ts`
- Create: `packages/localapp/tests/connection-manager.test.ts`
- Create: `packages/localapp/tests/notification-dispatcher.test.ts`
- Create: `packages/localapp/tests/click-ticket-store.test.ts`
- Modify: `packages/server/src/server.ts`
- Modify: `packages/server/src/lib/meta-sqlite.ts`
- Modify: `packages/localapp/src/daemon/daemon.ts`
- Modify: `packages/localapp/src/activation/activation-broker.ts`
- Modify: `packages/localapp/package.json`

**Interfaces:**
- Produces: local Server APIs to enable/disable the current account or an explicit verified peer as a device notification source.
- Produces: `NotificationConnectionManager.start/stop/reconfigure`.
- Produces: `NotificationDispatcher.deliver(source, notification): Promise<"shown" | "inbox-only">`.
- Produces: one-time `localapp://notification/open?ticket=...` activation and read-on-click.
- Consumes: Task 8 native adapter and Task 9 cursor protocol.

- [x] **Step 1: Write failing source, reconnect, and click tests**

```ts
it("baselines a newly enabled source at its current sequence", async () => {
  await manager.enable(source);
  expect(store.get(source.id)?.cursor).toBe(41);
  expect(adapter.shown).toEqual([]);
  await source.emit(notification(42));
  expect(adapter.shown.map((item) => item.id)).toEqual(["n42"]);
});

it("persists display before cursor and deduplicates reconnect", async () => {
  await manager.connect(sourceWith([notification(42), notification(43)]));
  await manager.reconnect(sourceWith([notification(42), notification(43)]));
  expect(adapter.shown.map((item) => item.id)).toEqual(["n42", "n43"]);
  expect(store.get(source.id)?.cursor).toBe(43);
});

it("notification click validates the source path before marking read", async () => {
  const url = await broker.activate(validTicket);
  expect(url).toBe(`${sourceOrigin}/owner/app/items/7`);
  expect(await sourceApi.wasMarkedRead("n43")).toBe(true);
});
```

- [x] **Step 2: Run notification-client tests and verify RED**

Run: `pnpm -C packages/localapp exec vitest run tests/connection-manager.test.ts tests/notification-dispatcher.test.ts tests/click-ticket-store.test.ts && pnpm -C packages/server exec vitest run tests/device-notification-source-store.test.ts tests/integration/device-notifications.test.ts`

Expected: FAIL because the daemon has no notification-source state or native dispatcher.

- [x] **Step 3: Implement explicit sources and reliable delivery**

Store source enablement, user/peer identity, encrypted credential reference,
cursor, last success, and bounded error text in the local Server. Do not return
credentials to Web. Connect each enabled source independently with `ws`, drain
eligible records oldest first, display then commit, and reconnect with
exponential backoff plus jitter. Cap individual catch-up to 100 records from
24 hours and group older backlog. Create an opaque one-time click ticket;
resolve the source notification on click, accept only its same-origin relative
path, then mark read and open it. Credential removal opens the source login or
inbox without marking read.

- [x] **Step 4: Run local/remote notification integration**

Run: `pnpm -C packages/localapp test && pnpm -C packages/server exec vitest run tests/integration/device-notifications.test.ts tests/integration/two-peer-sync.test.ts`

Expected: PASS; one unavailable peer cannot stop local or other remote sources and no notification is duplicated.

- [x] **Step 5: Commit the daemon notification client**

```bash
git add packages/localapp packages/server
git commit -m "feat(notify): deliver Server events through the daemon"
```

### Task 11: Add native permission/display behavior and Web settings

**Files:**
- Create: `packages/web/app/(dashboard)/my/device-notifications/page.tsx`
- Create: `packages/web/components/device-notifications/device-notifications-page.tsx`
- Create: `packages/web/components/device-notifications/device-notifications-page.test.tsx`
- Create: `packages/web/lib/device-notifications-api.ts`
- Modify: `packages/web/components/app-shell.tsx`
- Modify: `packages/server/src/routes/device-notifications.ts`
- Modify: `packages/localapp/src/native/native-adapter.ts`
- Modify: `packages/localapp/native/macos/LocalAppBridge.swift`
- Modify: `packages/localapp/native/windows/src/main.rs`
- Modify: `packages/localapp/src/notifications/notification-dispatcher.ts`
- Modify: `packages/localapp/tests/notification-dispatcher.test.ts`

**Interfaces:**
- Produces: permission states `not-determined | granted | denied | unsupported | unknown`.
- Produces: authenticated settings, enable/disable, quiet-hours, preview, and test-notification APIs.
- Consumes: Task 10 source configuration and dispatcher.

- [x] **Step 1: Write failing permission and Web journey tests**

```tsx
it("explains unavailable local integration without exposing a credential", async () => {
  render(<DeviceNotificationsPage initial={headlessState} />);
  expect(screen.getByText("此 Server 未启用本机设备集成")).toBeVisible();
  expect(screen.queryByText(/api[_-]?key/i)).not.toBeInTheDocument();
});

it("requests permission only after the explicit test-notification action", async () => {
  await dispatcher.start();
  expect(adapter.permissionRequests).toBe(0);
  await dispatcher.sendTestNotification(accountId);
  expect(adapter.permissionRequests).toBe(1);
});
```

- [x] **Step 2: Run Web and native-notification tests and verify RED**

Run: `pnpm -C packages/web exec vitest run components/device-notifications/device-notifications-page.test.tsx && pnpm -C packages/localapp exec vitest run tests/notification-dispatcher.test.ts`

Expected: FAIL because neither the Web surface nor explicit permission flow exists.

- [x] **Step 3: Implement settings and native display policy**

Add a Lucide-based Device Notifications page showing daemon/adapter version,
permission, explicit local/remote sources, connection state, cursor, quiet
hours, preview visibility, last error, and a test control. macOS uses
`UNUserNotificationCenter`; Windows implements App Notification display plus
the current-user activation registration and callback path deferred from Task
8; Linux implements the freedesktop interface and reports missing action
support. Send only plain text, safe local icon, application/source labels,
priority, and the opaque click URL. Denied permission is inbox-only and is
never re-prompted automatically.

- [x] **Step 4: Run Web, Server, and current-platform native tests**

Run: `pnpm -C packages/web test && pnpm -C packages/server exec vitest run tests/integration/device-notifications.test.ts && pnpm -C packages/localapp test:native`

Expected: PASS; settings never reveal secrets and a real local test notification is displayed when permission is granted.

- [x] **Step 5: Commit notification settings and adapters**

```bash
git add packages/web packages/server packages/localapp
git commit -m "feat(notify): add native notification settings"
```

### Task 12: Cut over release/build/test infrastructure and delete replaced Rust/Tauri products

**Implementation record:** Complete on `main`. The repository now publishes one
`localapp` npm tarball, consumes the same verified tarball in Docker, merges an
exact signed native-adapter matrix, verifies protocol/native contracts before a
daemon release can become current, and contains no Rust CLI or Tauri product.

**Files:**
- Delete: `packages/desktop/**`
- Delete: `packages/cli/**`
- Delete: `packages/localapp-core/**`
- Delete: `packages/localapp-template/**`
- Delete: `scripts/release-cli.mjs`
- Replace: `packages/shared/release-targets.json`
- Replace: `scripts/build-windows-release.ps1`
- Modify: `.github/workflows/ci.yml`
- Modify: `scripts/export-public-source.mjs`
- Modify: `scripts/docker-release-smoke.sh`
- Modify: `scripts/generate-release-manifest.mjs`
- Modify: `scripts/generate-release-manifest.node-test.mjs`
- Modify: `scripts/release-workflow.node-test.mjs`
- Modify: `package.json`
- Modify: `pnpm-workspace.yaml`
- Modify: `pnpm-lock.yaml`
- Modify: `packages/server/package.json`
- Modify: `packages/server/scripts/build-server-package.mjs`
- Modify: `packages/server/scripts/build-server-package.node-test.mjs`

**Interfaces:**
- Produces: `tmp/localapp-package/localapp-<version>.tgz` as the only product package.
- Produces: release target metadata for native adapters, not Rust CLI/Desktop installers.
- Consumes: all passing TypeScript CLI, daemon, Scheme, and notification suites.

- [x] **Step 1: Write failing destructive-boundary and npm-install tests**

```js
test("clean npm install provides every product entry without Rust or Tauri", async () => {
  const installed = await installPackedLocalApp(prefix);
  assert.equal(await command(installed.bin, ["--version"]), "localapp 0.1.0");
  assert.equal(await exists(path.join(installed.packageRoot, "packages/desktop")), false);
  assert.equal(await findText(installed.packageRoot, /workspace:\*|packages\/cli\/target/), null);
});
```

Add repository-boundary assertions that the four deleted package roots and all
Tauri/Rust release commands are absent, while the native adapter manifest lists
the supported platform/architecture targets.

- [x] **Step 2: Run cutover tests and verify RED**

Run: `pnpm test:release-workflow && pnpm test:public-source && pnpm -C packages/localapp test:package`

Expected: FAIL because old Rust/Tauri products and release metadata still exist.

- [x] **Step 3: Delete obsolete products and switch every build to the npm artifact**

Remove the listed directories only after Tasks 1–11 are green. Mark
`packages/server` private as an internal source package. Replace root scripts
with `package:localapp`, `test:localapp-package`, and adapter release checks.
Update CI to build Node/TypeScript everywhere and native adapters only on their
matching runners. Docker installs/runs the packed `localapp` artifact with
`localapp server run`; it does not embed a client binary or Desktop installer.

- [x] **Step 4: Run the post-deletion build and package matrix**

Run: `pnpm install --lockfile-only && pnpm -r build && pnpm -r test && pnpm test:localapp-package && pnpm test:public-source && pnpm test:release-workflow`

Expected: PASS with no Cargo/Tauri command in the ordinary product build and no missing generated-project command.

- [x] **Step 5: Commit destructive cutover**

```bash
git add -A packages scripts .github package.json pnpm-workspace.yaml pnpm-lock.yaml
git commit -m "refactor: cut over to the single localapp npm package"
```

### Task 13: Update developer guidance and complete local product acceptance

**Files:**
- Modify: `AGENTS.md`
- Modify: `README.md`
- Modify: `docs/local-runtime.md`
- Modify: `docs/windows-local-release.md`
- Modify: `docs/open-source-release.md`
- Modify: `init-repo/AGENTS.md`
- Modify: `init-repo/CLAUDE.md`
- Modify: `init-repo/.claude/skills/localapp/SKILL.md`
- Modify: `init-repo/.claude/skills/localapp-development/SKILL.md`
- Modify: `init-repo/.claude/skills/localapp-testing/SKILL.md`
- Create: `docs/verification/2026-08-12-single-package-notifications-acceptance.md`
- Modify: `packages/server/tests/e2e-unified/real-apps.spec.ts`
- Modify: `examples/skill-market/ACCEPTANCE.md`
- Modify: `examples/resume-manager/ACCEPTANCE.md`

**Interfaces:**
- Produces: reproducible commands and evidence for package install, daemon, Scheme, native notification, SKILL install, and resume media.
- Consumes: the packed npm artifact only; source-tree launchers and Rust/Tauri binaries are forbidden in acceptance.

- [ ] **Step 1: Add failing packaged-product acceptance gates**

Extend the real-app suite so it installs the generated npm tarball into
`tmp/single-package-acceptance/npm-prefix`, invokes only that `localapp`, starts
clean Server data below `tmp/single-package-acceptance/server`, installs both
applications, and asserts formal URLs. Add deterministic assertions for the
notification inbox row, native adapter envelope, click ticket, and read state.

- [ ] **Step 2: Run acceptance gates and verify RED**

Run: `pnpm test:localapp-package && pnpm test:real-apps`

Expected: FAIL if any path resolves a source-tree launcher, old binary, Tauri bridge, raw `/serve` acceptance URL, or system temporary directory.

- [ ] **Step 3: Rewrite guidance around the final product**

Document only `npm install localapp`, `localapp server`, the supported
TypeScript CLI commands, explicit remote notification sources, formal routes,
Device Actions through `localapp://`, content upload/preview/download, and
in-app Browser validation. Remove tray, Tauri, Rust CLI, `localapp-server`,
MiniServer, Local Runtime, legacy upload, and `<app>.localhost` instructions.

- [ ] **Step 4: Run automated verification from clean local state**

Run:

```bash
pnpm install --frozen-lockfile
pnpm -r build
pnpm -r test
pnpm test:localapp-package
pnpm test:local-dev-package
pnpm test:real-apps
pnpm test:platform-regression
pnpm test:public-source
pnpm test:release-workflow
git diff --check
```

Expected: every command exits 0 with all generated state below repository `tmp/`.

- [ ] **Step 5: Verify SKILL marketplace through the in-app Browser**

Read and use `browser:control-in-app-browser`. Open the formal packaged Server
SKILL marketplace URL, log in, select the fixture SKILL, click install, follow
the real `localapp://` activation on this computer, approve first-publisher
trust in the local Web page, and observe source-page success. Verify
`tmp/single-package-acceptance/installed-skills/<skill>/SKILL.md` and its digest.
Repeat identical permissions without a prompt and expanded permissions with a
new prompt. Capture DOM and console state after each transition.

- [ ] **Step 6: Verify resume media through the in-app Browser**

Open the formal resume-manager URL, upload the deterministic PNG and PDF, show
the image lightbox and PDF page preview, download both originals below
`tmp/single-package-acceptance/downloads`, compare bytes, and verify a fresh tab
has no application console errors.

- [ ] **Step 7: Verify a real native notification and click**

In Web Device Notifications settings, enable the current account, grant the OS
permission, send a test notification, and observe the native popup. Trigger an
application notification from the formal app, observe both inbox and native
popup, click it, verify the validated formal application route opens, and
confirm the source inbox row becomes read. Stop/restart the daemon, create two
offline notifications, and verify ordered, duplicate-free catch-up.

- [ ] **Step 8: Request review and repair every actionable finding**

Review the complete diff for package leakage, credential exposure, unsafe
Scheme parsing, notification mute bypass, process lifecycle gaps, release
target omissions, stale documentation, and unrelated user files. Turn each
confirmed defect into a failing test before its fix and rerun the affected
matrix.

- [ ] **Step 9: Commit verification evidence and push `main`**

```bash
git add AGENTS.md README.md docs init-repo examples packages/server/tests/e2e-unified
git commit -m "test(acceptance): verify single-package LocalApp journeys"
git push origin main
```

Record the exact npm tarball digest, Server URL, application URLs, native
adapter target, notification result, Browser console state, and test counts in
the verification document. Stop every acceptance process while preserving the
explicit evidence directories below `tmp/`.

## Plan Self-Review

- Spec coverage: Tasks 1–6 cover the one-package TypeScript development
  toolchain; Tasks 7–8 cover daemon and Scheme; Tasks 9–11 cover durable native
  notifications and Web settings; Task 12 removes the replaced products; Task
  13 covers guidance, both applications, native notification, Browser evidence,
  commit, and push.
- Placeholder scan: every implementation step names concrete files,
  interfaces, tests, commands, outcomes, and commit scope; no deferred product
  behavior is hidden behind an unspecified follow-up.
- Type consistency: `LocalAppCommand`, `ProfileStore`, `LocalAppClient`,
  `buildApplicationPackage`, `ServiceManager`, `NativeAdapter`, delivery
  sequences, notification sources, and click tickets are introduced before
  their consumers.
- Destructive-order check: Rust CLI and Tauri are deleted only after their
  required journeys pass through the TypeScript package and native adapters.
- Execution choice: the user already selected direct execution on `main`, so
  this plan is executed inline with review checkpoints rather than pausing for
  another execution-mode decision.

# Unified Server, Device Actions, and Native Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the separate Local Runtime and full Desktop client with one distributable Node Server, one Server-hosted Web control plane, peer application synchronization, a generic current-computer Device Action substrate, and an optional two-item native bridge and tray; prove the result with two real local applications.

**Architecture:** `@localapp/server` becomes a reusable Fastify application plus a supervised `localapp-server` executable. Every deployment runs the same Server bundle and Web assets; configuration selects listener and storage providers. Server-owned workspaces, tasks, peers, synchronization, Device Action trust, and Device Action execution are implemented as focused services and routes. The Tauri package becomes a windowless `localapp://` bridge and process launcher that bundles the exact Server artifact but no second business backend.

**Tech Stack:** Node.js 24+, TypeScript, Fastify 4, Next.js 15 static export, Vitest 4, Playwright, sql.js, Rust 2024, Tauri 2, pnpm, Cargo.

**Implementation status (2026-08-10):** Tasks 1–6 are implemented and reviewed on `main`. Task 7 is implemented and in its final durability review. Tasks 8–15 are pending. The SDD progress ledger records commit-level evidence and is updated after every review round.

## Global Constraints

- There is one canonical `@localapp/server`; do not preserve a MiniServer or Local Runtime execution path.
- A fresh Server starts empty and never scans, imports, migrates, or deletes legacy Desktop data.
- Local and remote deployments use the same users, sessions, API keys, application routes, Platform Shell, and Named SQL implementation.
- New interactive installations listen on `127.0.0.1` until an administrator explicitly enables LAN access.
- Initial setup uses a short-lived, single-use setup token and creates the first administrator; there is no `local-user` identity.
- Server instances are equal, independent peers. They do not proxy, manage, or automatically replicate each other.
- Peer credentials are target-user API keys encrypted at rest and never returned to the browser.
- Application-only synchronization is the default and preserves target business data and uploaded files.
- Application-plus-data synchronization is explicit, replaces the target database and files from a consistent snapshot, and rolls back atomically on failure.
- Users, permissions, sessions, API keys, and platform data never synchronize.
- Studio can access only Server-managed workspaces under `<data-dir>/workspaces`.
- The primary distribution is the Node package; the optional Tauri bridge has no window and exactly `打开主页` and `退出本地服务` in its tray menu.
- Generic Device Actions are a Server and SDK capability available to every hosted application; SKILL installation is only an acceptance application use case.
- A Scheme activation always targets the computer where the click occurred. Do not add device registration, a device picker, cross-device dispatch, or a permanent remote-control channel.
- `localapp://` carries only source origin, protocol version, action ID, and a short-lived high-entropy nonce. It never carries scripts, dependencies, Server credentials, or user data.
- The native bridge only starts/supervises Server and forwards strictly parsed activation tickets through an authenticated loopback control endpoint. Trust, dependency preparation, script execution, logs, and recovery live in `@localapp/server`.
- Device Action trust is keyed by source origin, application identity, immutable publisher ID, and canonical permission-set digest. The first action and every permission expansion require confirmation by a local Server administrator.
- Device Action execution uses the bundled Node runtime's permission system, minimal environment, bounded logs/time, process-tree cancellation, and no inherited Server secrets. Child-process permission is disclosed as arbitrary current-OS-user code execution until containers are introduced.
- All generated data, Server data directories, acceptance downloads, and installed test SKILLs live below `<repo>/tmp`; never use `/tmp` for this plan's manual or Browser acceptance.
- Final UI acceptance must use `browser:control-in-app-browser`, formal `/<owner>/<app>/` routes, and local loopback URLs only.
- Every newly initialized application includes pinned `react-pdf@10.4.1`, `pdfjs-dist@6.1.200`, and `yet-another-react-lightbox@3.32.1` dependencies plus guidance for upload, preview, and download.
- Delete legacy commands and product surfaces directly; do not add compatibility aliases or a migration phase.
- Follow red-green-refactor for every behavior change. No production implementation precedes its failing test.

---

### Task 1: Extract a reusable Server application and implement clean first-run setup

**Files:**
- Create: `packages/server/src/server.ts`
- Create: `packages/server/src/lib/setup-token-store.ts`
- Create: `packages/server/src/routes/setup.ts`
- Create: `packages/server/tests/integration/setup-flow.test.ts`
- Modify: `packages/server/src/index.ts`
- Modify: `packages/server/src/plugins/storage.ts`
- Modify: `packages/server/src/lib/meta-sqlite.ts`
- Modify: `packages/server/tests/integration/helpers.ts`
- Modify: `packages/server/tests/bootstrap-admin.test.ts`

**Interfaces:**
- Produces: `buildServer(options: BuildServerOptions): Promise<FastifyInstance>` in `server.ts`.
- Produces: `BuildServerOptions = { env?: NodeJS.ProcessEnv; webRoot?: string; setupTokens?: SetupTokenStore }`.
- Produces: `SetupTokenStore.issue(now?: number): { token: string; expiresAt: number }`, `consume(token: string, now?: number): boolean`, and `revokeAll(): void`.
- Produces: `GET /api/setup/status` and `POST /api/setup/initialize`.
- Removes: automatic `localadmin` creation from `initMetaDb`.

- [ ] **Step 1: Write failing clean-setup integration tests**

```ts
it("starts empty and consumes the setup token after creating the first administrator", async () => {
  const server = await createTestServer({ cleanSetup: true });
  const issued = server.setupTokens.issue();

  expect((await fetch(`${server.baseUrl}/api/setup/status`).then(r => r.json())).data)
    .toEqual({ required: true });

  const created = await fetch(`${server.baseUrl}/api/setup/initialize`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: issued.token, username: "owner", password: "correct-horse-battery" }),
  });
  expect(created.status).toBe(201);
  expect(findUserByName("owner")?.role).toBe("admin");

  const replay = await fetch(`${server.baseUrl}/api/setup/initialize`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: issued.token, username: "second", password: "correct-horse-battery" }),
  });
  expect(replay.status).toBe(410);
});
```

- [ ] **Step 2: Run the setup tests and verify RED**

Run: `pnpm -C packages/server exec vitest run tests/integration/setup-flow.test.ts tests/bootstrap-admin.test.ts`

Expected: FAIL because `cleanSetup`, setup routes, and `SetupTokenStore` do not exist and `initMetaDb` still creates the bootstrap user.

- [ ] **Step 3: Extract route registration into `buildServer`**

```ts
export interface BuildServerOptions {
  env?: NodeJS.ProcessEnv;
  webRoot?: string;
  setupTokens?: SetupTokenStore;
}

export async function buildServer(options: BuildServerOptions = {}): Promise<FastifyInstance> {
  const config = await loadConfig(options.env ?? process.env);
  const app = Fastify({ ignoreTrailingSlash: true });
  app.decorate("config", config);
  await registerServerPluginsAndRoutes(app, {
    webRoot: options.webRoot,
    setupTokens: options.setupTokens ?? new SetupTokenStore(),
  });
  return app;
}
```

Move all current plugin, route, request-log, and close-hook registration from `index.ts` into this factory. `index.ts` must only build, listen, report readiness, and handle fatal errors.

- [ ] **Step 4: Implement setup-token and initial-admin services**

```ts
export class SetupTokenStore {
  private readonly tokens = new Map<string, number>();
  constructor(private readonly ttlMs = 15 * 60_000) {}

  issue(now = Date.now()) {
    const token = crypto.randomBytes(32).toString("base64url");
    const expiresAt = now + this.ttlMs;
    this.tokens.set(hashToken(token), expiresAt);
    return { token, expiresAt };
  }

  consume(token: string, now = Date.now()): boolean {
    const key = hashToken(token);
    const expiresAt = this.tokens.get(key);
    this.tokens.delete(key);
    return expiresAt !== undefined && expiresAt > now;
  }

  revokeAll() { this.tokens.clear(); }
}
```

`POST /api/setup/initialize` must require zero users, consume a valid token, validate username/password, create the administrator and everyone group in one meta-DB transaction, revoke all setup tokens, and return `201` without issuing a session.

- [ ] **Step 5: Make test and production startup use the same factory**

Replace duplicated registration in `tests/integration/helpers.ts` with `buildServer({ env, setupTokens })`. Return `baseUrl` and `setupTokens` from the helper. Remove bootstrap-user assertions and replace them with assertions that a fresh database has zero users.

- [ ] **Step 6: Run Server tests and verify GREEN**

Run: `pnpm -C packages/server test`

Expected: all Server tests pass; tests that previously relied on `localadmin` explicitly initialize an admin through the setup service or test helper.

- [ ] **Step 7: Commit the reusable Server and setup flow**

```bash
git add packages/server/src packages/server/tests
git commit -m "feat(server): add reusable startup and first-run setup"
```

---

### Task 2: Add unified Server configuration, supervision, and network rebinding

**Files:**
- Create: `packages/server/src/cli.ts`
- Create: `packages/server/src/worker.ts`
- Create: `packages/server/src/lib/server-config-store.ts`
- Create: `packages/server/src/routes/system.ts`
- Create: `packages/server/tests/config-store.test.ts`
- Create: `packages/server/tests/integration/system-settings.test.ts`
- Create: `packages/server/tests/supervisor.node-test.mjs`
- Modify: `packages/server/src/lib/config.ts`
- Modify: `packages/server/src/server.ts`
- Modify: `packages/server/package.json`

**Interfaces:**
- Produces: `ServerConfig.listenHost`, `listenPort`, `publicUrl`, `workspaceDir`, `jwtKeyFile`, `masterKeyFile`, `allowInsecureLan`, and existing service settings.
- Produces: `ServerConfigStore.read()`, async `validate(candidate)`, and `write(candidate)`.
- Extends: `BuildServerOptions` with an injectable `restartController: RestartController` for route tests and worker supervision.
- Produces: `GET /api/system/status`, `GET /api/system/settings`, and admin-only `PUT /api/system/settings/network`.
- Produces: worker readiness message `{ type: "ready"; url: string; setupUrl?: string }` on IPC or stdout.
- Produces: restart exit code `75`; `localapp-server start` restarts the worker only for this code.

- [ ] **Step 1: Write failing configuration and rebind tests**

```ts
it("defaults to loopback and rejects LAN binding without acknowledgement", async () => {
  const config = await loadConfig({ DATA_DIR: dataDir, JWT_SECRET: "secret" });
  expect(config.listenHost).toBe("127.0.0.1");

  await expect(store.validate({ ...config, listenHost: "0.0.0.0" }))
    .rejects.toThrow("allowInsecureLan");
});

it("persists a validated network change and requests supervised restart", async () => {
  const response = await adminPut("/api/system/settings/network", {
    listenHost: "0.0.0.0",
    listenPort: 43127,
    allowInsecureLan: true,
  });
  expect(response.status).toBe(202);
  expect(await response.json()).toMatchObject({ success: true, data: { restarting: true } });
  expect(requestRestart).toHaveBeenCalledWith(75);
});
```

- [ ] **Step 2: Run targeted tests and verify RED**

Run: `pnpm -C packages/server exec vitest run tests/config-store.test.ts tests/integration/system-settings.test.ts`

Expected: FAIL because the unified configuration fields, store, and system routes do not exist.

- [ ] **Step 3: Implement the configuration store and admin system routes**

Persist non-secret settings to `<data-dir>/server.json` with mode `0600` on Unix. Resolve paths against `dataDir`. Environment variables override persisted values. If no `JWT_SECRET` override exists, generate a random 32-byte instance signing key once at `jwtKeyFile` with restrictive permissions; a clean packaged Server must therefore boot without hand-written secrets. Never serialize signing keys, storage credentials, or the peer master key from `GET /api/system/settings`.

```ts
export type PublicSystemSettings = Pick<ServerConfig,
  "listenHost" | "listenPort" | "publicUrl" | "workspaceDir" | "allowInsecureLan"
>;

export interface RestartController {
  requestRestart(exitCode: 75): void;
}

export interface ServerConfigStore {
  read(): Promise<ServerConfig>;
  validate(candidate: ServerConfig): Promise<ServerConfig>;
  write(candidate: ServerConfig): Promise<void>;
}
```

Validate the candidate listener with a temporary `node:net` server before saving it. Respond `202`, then call `requestRestart(75)` after the response completes.

- [ ] **Step 4: Implement the supervised executable**

`cli.ts` parses `localapp-server start --data-dir --host --port`, spawns `worker.js`, forwards signals, prints readiness JSON, and restarts only when the worker exits with `75`. `worker.ts` builds the Server, listens with configured host/port, issues a setup token when no users exist, and sends the readiness message.

```ts
if (message.type === "ready") {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}
if (code === 75 && !stopping) {
  child = spawnWorker();
}
```

- [ ] **Step 5: Verify supervisor restart behavior**

Run: `node --test packages/server/tests/supervisor.node-test.mjs`

Expected: PASS; the test starts on loopback, requests a port change, observes one worker replacement, and reaches `/health` on the new port.

- [ ] **Step 6: Run Server build and tests**

Run: `pnpm -C packages/server build && pnpm -C packages/server test`

Expected: PASS with no duplicate route-registration helper in tests.

- [ ] **Step 7: Commit unified configuration and supervision**

```bash
git add packages/server
git commit -m "feat(server): add supervised unified configuration"
```

---

### Task 3: Introduce one atomic application installer for browser, CLI, and peers

**Files:**
- Create: `packages/server/src/lib/app-package.ts`
- Create: `packages/server/src/lib/app-installer.ts`
- Create: `packages/server/src/routes/apps.ts`
- Create: `packages/server/tests/integration/app-package-install.test.ts`
- Modify: `packages/server/src/routes/upload.ts`
- Modify: `packages/server/src/server.ts`
- Modify: `packages/server/src/plugins/storage.ts`
- Modify: `packages/server/src/lib/app-data-maintenance.ts`
- Modify: `packages/server/src/types/models.ts`
- Modify: `packages/server/src/types/api.ts`
- Modify: `packages/server-core/src/types/models.ts`

**Interfaces:**
- Produces: `inspectAppPackage(filePath): Promise<InspectedAppPackage>`.
- Produces: `installAppPackage(input: InstallAppPackageInput): Promise<InstallOutcome>`.
- Produces: `POST /api/me/apps/install` accepting a `.localapp` file.
- Produces: `GET /api/me/apps/:name/versions`, `POST /api/me/apps/:name/versions/:version/activate`, and `POST /api/me/apps/:name/rollback`.
- `uploadRoutes` delegates final validation and activation to the same installer service.
- Keeps the existing numeric `PageMeta.currentVersion` as the local deployment sequence; every version entry additionally stores stable `appVersion: string` and `digest: string`, which are used for peer identity and conflict detection.

- [ ] **Step 1: Write a failing atomic package-install test**

```ts
it("installs a portable package for the authenticated owner and preserves the old version on migration failure", async () => {
  const first = await installFixturePackage(ownerCookie, fixturePackage({ version: "1.0.0" }));
  expect(first.status).toBe(201);

  const broken = await installFixturePackage(ownerCookie, fixturePackage({
    version: "2.0.0",
    migration: "THIS IS NOT SQL",
  }));
  expect(broken.status).toBe(400);

  const app = await readInstalledApp("owner", "interview-app");
  expect(app.currentAppVersion).toBe("1.0.0");
});
```

- [ ] **Step 2: Run the package-install test and verify RED**

Run: `pnpm -C packages/server exec vitest run tests/integration/app-package-install.test.ts`

Expected: FAIL because the package endpoint and installer do not exist.

- [ ] **Step 3: Implement safe package inspection**

Use `yauzl` in lazy-entry mode. Reject absolute paths, `..`, symlinks, duplicate entries, unsupported compression, mismatched checksums, excessive expanded size, excessive file count, missing `manifest.json`, missing `dist/index.html`, and backend files outside the declared root.

```ts
export interface InspectedAppPackage {
  packagePath: string;
  name: string;
  version: string;
  digest: string;
  manifest: Record<string, unknown>;
  entries: readonly PackageEntry[];
}
```

- [ ] **Step 4: Implement atomic installation and shared activation**

Stage under `<data-dir>/.staging/apps/<job-id>`, validate the backend contract, back up the target database, apply migrations, write version metadata, health-check the staged version, and atomically update current-version metadata. Restore the database and previous metadata on failure. Preserve the existing numeric directory/version sequence for storage compatibility inside the unified Server, but expose and compare the package's stable `appVersion` plus `digest`; installing the same pair is idempotent and reusing an `appVersion` with a different digest is a conflict.

- [ ] **Step 5: Refactor multipart upload to use the installer**

Keep the existing `/api/upload` wire format only until Task 11 removes the old command. Convert its collected files into a staged package and call `installAppPackage`; remove its duplicate activation and rollback implementation.

- [ ] **Step 6: Run application and upload regression tests**

Run: `pnpm -C packages/server exec vitest run tests/integration/app-package-install.test.ts tests/integration/upload-atomic-migrations.test.ts tests/integration/full-workflow.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit the atomic installer**

```bash
git add packages/server
git commit -m "feat(server): unify atomic application installation"
```

---

### Task 4: Move Studio workspaces and task execution into Server services

**Files:**
- Create: `packages/server/src/lib/workspace-store.ts`
- Create: `packages/server/src/lib/workspace-path.ts`
- Create: `packages/server/src/lib/task-store.ts`
- Create: `packages/server/src/lib/task-runner.ts`
- Create: `packages/server/src/lib/agent-runner.ts`
- Create: `packages/server/src/lib/agents/codex-agent.ts`
- Create: `packages/server/src/lib/agents/opencode-agent.ts`
- Create: `packages/server/src/lib/agents/types.ts`
- Create: `packages/server/runner/localapp-runner.mjs`
- Create: `packages/server/tests/runner-protocol.node-test.mjs`
- Create: `packages/server/src/routes/workspaces.ts`
- Create: `packages/server/src/routes/tasks.ts`
- Create: `packages/server/tests/workspace-path.test.ts`
- Create: `packages/server/tests/integration/workspaces.test.ts`
- Create: `packages/server/tests/integration/tasks.test.ts`
- Modify: `packages/server/src/lib/meta-sqlite.ts`
- Modify: `packages/server/src/server.ts`
- Modify: `packages/server/package.json`

**Interfaces:**
- Produces: `WorkspaceStore.create`, `clone`, `importArchive`, `list`, `readFile`, `writeFile`, `remove`, `build`, and `install`.
- Produces: `resolveWorkspacePath(workspaceRoot, relativePath): string` with realpath confinement.
- Produces: `TaskRunner.start(input): Promise<TaskRecord>`, `cancel(id)`, `logs(id, cursor)`, and `events(id)`.
- Produces routes under `/api/workspaces` and `/api/tasks` using normal session/API-key authorization.

- [ ] **Step 1: Write failing workspace-boundary and task-lifecycle tests**

```ts
it("rejects traversal and symlink escape from a managed workspace", async () => {
  expect(() => resolveWorkspacePath(root, "../../outside.txt")).toThrow("workspace boundary");
  await fs.symlink(outside, path.join(root, "link"));
  expect(() => resolveWorkspacePath(root, "link/secret.txt")).toThrow("workspace boundary");
});

it("persists, streams, and cancels a workspace task", async () => {
  const started = await postTask({ workspaceId, command: "node", args: ["slow-task.mjs"] });
  expect(started.status).toBe("running");
  await cancelTask(started.id);
  expect((await getTask(started.id)).status).toBe("cancelled");
  expect(await readTaskLog(started.id)).toContain("started");
});
```

- [ ] **Step 2: Run targeted tests and verify RED**

Run: `pnpm -C packages/server exec vitest run tests/workspace-path.test.ts tests/integration/workspaces.test.ts tests/integration/tasks.test.ts`

Expected: FAIL because Server-owned workspaces and tasks do not exist.

- [ ] **Step 3: Implement workspace storage**

Store records in the meta DB and files under `<workspaceDir>/<workspace-id>`. Generate UUID workspace IDs. Accept project creation, Git clone with `--` argument separation, and archive import. Reject arbitrary absolute paths. Use temp directories and atomic rename for clone/import.

- [ ] **Step 4: Implement the task store and process runner**

```ts
export interface StartTaskInput {
  workspaceId: string;
  kind: "build" | "test" | "git" | "agent";
  executable: string;
  args: string[];
  timeoutMs: number;
  requestedBy: string;
}
```

Spawn with `shell: false`, workspace `cwd`, an allowlisted executable, bounded environment, output file, process-group cancellation, timeout, and persisted transitions. Reconcile `running` tasks to `interrupted` on startup.

- [ ] **Step 5: Port Agent execution behind `AgentRunner`**

Move the runner protocol from `packages/desktop/src-tauri/runner/localapp-runner.mjs` into the Server package and preserve it with a Node protocol test. Implement Codex and OpenCode adapters with the same `start/send/cancel/logs` interface. Keep protocol parsing in separate adapter files and emit task events through Server-Sent Events. Capability output must report unavailable executables rather than selecting a different runtime.

- [ ] **Step 6: Register routes and run tests**

Run: `pnpm -C packages/server test`

Expected: PASS, including workspace archive limits, permission checks, process cleanup, timeout, and startup reconciliation.

- [ ] **Step 7: Commit Server-owned Studio and tasks**

```bash
git add packages/server
git commit -m "feat(server): add managed workspaces and tasks"
```

---

### Task 5: Move every management surface into the Server-hosted Web application

**Files:**
- Create: `packages/web/app/setup/page.tsx`
- Create: `packages/web/components/setup/setup-page.tsx`
- Create: `packages/web/components/setup/setup-page.test.tsx`
- Create: `packages/web/app/(dashboard)/my/studio/page.tsx`
- Create: `packages/web/app/(dashboard)/my/tasks/page.tsx`
- Create: `packages/web/app/(dashboard)/my/system/page.tsx`
- Create: `packages/web/components/studio/studio-page.tsx`
- Create: `packages/web/components/tasks/tasks-page.tsx`
- Create: `packages/web/components/system/system-page.tsx`
- Create: `packages/web/components/studio/studio-page.test.tsx`
- Create: `packages/web/components/tasks/tasks-page.test.tsx`
- Create: `packages/web/components/system/system-page.test.tsx`
- Modify: `packages/web/components/app-shell.tsx`
- Modify: `packages/server/src/routes/my-serve.ts`
- Modify: `packages/server/tests/integration/homepage-redirect.test.ts`

**Interfaces:**
- Consumes: `/api/setup/*`, `/api/workspaces`, `/api/tasks`, `/api/system/*`, and existing application/user/inbox/favorite APIs.
- Produces: static-export routes `/setup`, `/my/studio`, `/my/tasks`, and `/my/system`.

- [ ] **Step 1: Write failing navigation and page behavior tests**

```tsx
it("shows Studio, tasks, and system administration in the Web shell", async () => {
  render(<AppShell><div>content</div></AppShell>);
  expect(await screen.findByRole("link", { name: "Studio" })).toHaveAttribute("href", "/my/studio");
  expect(screen.getByRole("link", { name: "任务" })).toHaveAttribute("href", "/my/tasks");
  expect(screen.getByRole("link", { name: "系统设置" })).toHaveAttribute("href", "/my/system");
});
```

Add page tests that initialize the first administrator with the setup token, create/import a workspace, edit a file, start/cancel a task, and request a network setting change.

- [ ] **Step 2: Run Web tests and verify RED**

Run: `pnpm -C packages/web test`

Expected: FAIL because the new routes and navigation items do not exist.

- [ ] **Step 3: Implement focused API clients and pages**

Each component owns one feature area and uses same-origin `fetch` with credentials. The setup page reads the token only from its initial URL, removes it from browser history after loading, clears it after submission, and never persists it. Use EventSource for task logs.

- [ ] **Step 4: Serve every static-export route from Server**

Extend the setup/static route mapping plus `myServeRoutes.ADMIN_PAGES` for the three dashboard routes and their `.txt` flight payloads. Add direct route tests proving the setup page is available only while setup is required, unauthenticated dashboard redirects, and admin authorization for system settings.

- [ ] **Step 5: Run Web and Server route tests**

Run: `pnpm -C packages/web test && pnpm -C packages/web build && pnpm -C packages/server exec vitest run tests/integration/homepage-redirect.test.ts`

Expected: PASS and static files exist at `packages/web/out/setup.html` and under `packages/web/out/my/{studio,tasks,system}.html`.

- [ ] **Step 6: Commit the Web control plane**

```bash
git add packages/web packages/server/src/routes/my-serve.ts packages/server/tests/integration/homepage-redirect.test.ts
git commit -m "feat(web): move management into the server control plane"
```

---

### Task 6: Add encrypted peer configuration and capability verification

**Files:**
- Create: `packages/server/src/lib/secret-box.ts`
- Create: `packages/server/src/lib/peer-store.ts`
- Create: `packages/server/src/lib/peer-client.ts`
- Create: `packages/server/src/routes/peers.ts`
- Create: `packages/server/src/routes/peer-protocol.ts`
- Create: `packages/server/tests/secret-box.test.ts`
- Create: `packages/server/tests/integration/peers.test.ts`
- Create: `packages/web/app/(dashboard)/my/peers/page.tsx`
- Create: `packages/web/components/peers/peers-page.tsx`
- Create: `packages/web/components/peers/peers-page.test.tsx`
- Modify: `packages/server/src/lib/config.ts`
- Modify: `packages/server/src/lib/meta-sqlite.ts`
- Modify: `packages/server/src/server.ts`
- Modify: `packages/server/src/routes/my-serve.ts`
- Modify: `packages/server/tests/integration/homepage-redirect.test.ts`
- Modify: `packages/web/components/app-shell.tsx`

**Interfaces:**
- Produces: `SecretBox.seal(plaintext): string` and `open(ciphertext): string` using AES-256-GCM.
- Produces: `PeerStore.create`, `listPublic`, `replaceCredential`, `remove`, and `loadCredential`.
- Produces: `GET/POST/PATCH/DELETE /api/peers` and `POST /api/peers/:id/check`.
- Produces: `GET /api/peer/capabilities` authenticated by target-user API Key.
- Produces: static-export route `/my/peers` and its admin-only Web navigation entry.

- [ ] **Step 1: Write failing secret and peer tests**

```ts
it("stores an encrypted API key and never returns it", async () => {
  const created = await adminPost("/api/peers", {
    name: "office",
    baseUrl: target.baseUrl,
    apiKey: target.ownerApiKey,
  });
  expect(created.body.data).not.toHaveProperty("apiKey");
  expect(await readPeerCiphertext(created.body.data.id)).not.toContain(target.ownerApiKey);
  expect(await sourcePeerStore.loadCredential(created.body.data.id)).toBe(target.ownerApiKey);
});
```

Add a Web test that submits a target URL and API Key, clears the input after submission, lists only public peer metadata, and never redisplays the stored credential.

- [ ] **Step 2: Run peer tests and verify RED**

Run: `pnpm -C packages/server exec vitest run tests/secret-box.test.ts tests/integration/peers.test.ts`

Expected: FAIL because peer storage and encryption do not exist.

- [ ] **Step 3: Implement master-key and authenticated encryption**

Load a 32-byte key from the configured master-key file. Generate it once with restrictive filesystem permissions when absent. Store versioned `iv.ciphertext.tag` base64url fields and bind the peer ID as additional authenticated data.

- [ ] **Step 4: Implement peer CRUD and capability verification**

Normalize URLs, reject embedded credentials and fragments, require HTTPS unless the administrator explicitly accepts insecure LAN, and fetch capabilities with `Authorization: Bearer <api-key>`. Persist verified user ID, display name, protocol version, limits, and timestamp.

- [ ] **Step 5: Implement the peer Web page and route**

Add `/my/peers` to the Web shell and Server static-route mapping. Keep the API Key only in component state until submission, clear it in `finally`, and render only public peer metadata returned by `PeerStore.listPublic`.

- [ ] **Step 6: Run peer and security tests**

Run: `pnpm -C packages/server exec vitest run tests/secret-box.test.ts tests/integration/peers.test.ts tests/integration/security-boundary.test.ts && pnpm -C packages/web test && pnpm -C packages/web build`

Expected: PASS; logs and JSON snapshots contain no plaintext peer API keys.

- [ ] **Step 7: Commit peer configuration**

```bash
git add packages/server packages/web
git commit -m "feat(server): add encrypted peer connections"
```

---

### Task 7: Implement application-only peer synchronization

**Files:**
- Create: `packages/server/src/lib/sync-job-store.ts`
- Create: `packages/server/src/lib/sync-session-store.ts`
- Create: `packages/server/src/lib/app-sync-source.ts`
- Create: `packages/server/src/lib/app-sync-target.ts`
- Create: `packages/server/src/routes/sync.ts`
- Create: `packages/server/tests/integration/two-peer-sync.test.ts`
- Modify: `packages/server/src/lib/meta-sqlite.ts`
- Modify: `packages/server/src/server.ts`
- Modify: `packages/web/components/peers/peers-page.tsx`
- Modify: `packages/web/components/peers/peers-page.test.tsx`

**Interfaces:**
- Produces the sync-session peer endpoints defined in the approved specification.
- Produces source endpoint `POST /api/me/apps/:name/sync` with `{ peerId, withData: false }`.
- Produces persisted job states `queued`, `staging`, `validating`, `backing-up`, `installing`, `activating`, `completed`, `rolled-back`, `failed`, and `recovery-required`.
- Consumes: `inspectAppPackage` and `installAppPackage` from Task 3.

- [ ] **Step 1: Write failing two-peer application tests**

```ts
it("pushes an application to the target API-key owner and preserves target data", async () => {
  await installSourceVersion("notes", "2.0.0");
  await seedTargetBusinessRow("target-owner", "notes", "keep-me");

  const job = await sourceSync("notes", { peerId, withData: false });
  await expectJob(job.id, "completed");

  expect(await targetCurrentAppVersion("target-owner", "notes")).toBe("2.0.0");
  expect(await targetBusinessRows("target-owner", "notes")).toContainEqual({ id: "keep-me" });
});

it("treats an identical version as idempotent and rejects a digest conflict", async () => {
  expect((await sourceSync("notes", { peerId, withData: false })).status).toBe(202);
  expect((await sourceSync("notes", { peerId, withData: false })).status).toBe(202);
  await replaceSourcePackageWithoutChangingVersion();
  expect((await sourceSync("notes", { peerId, withData: false })).status).toBe(409);
});
```

- [ ] **Step 2: Run the two-peer test and verify RED**

Run: `pnpm -C packages/server exec vitest run tests/integration/two-peer-sync.test.ts`

Expected: FAIL because synchronization sessions and jobs do not exist.

- [ ] **Step 3: Implement target staging sessions**

Create session metadata under `<data-dir>/.staging/sync/<session-id>`. Stream uploads to `.partial` files while hashing, fsync, verify declared size/digest, then atomically rename. Enforce target capability limits and API-key owner authorization on every request.

- [ ] **Step 4: Implement source push and target commit**

Build one deterministic package from the active source version, create a target session, upload, commit, and persist progress after every state transition. The target owner always comes from the API Key: the first synchronization creates `<api-key-user>/<unchanged-app-name>`, and later synchronization of that name creates a new local deployment sequence. Compare stable `appVersion` plus `digest`; matching pairs are idempotent and a reused `appVersion` with another digest returns `409`. Delegate installation and rollback to Task 3 services.

- [ ] **Step 5: Implement cancellation, idempotency, and pruning**

Use a client-generated synchronization ID. Repeated metadata and upload calls with matching digests return the existing session. Conflicting metadata returns `409`. Delete abandoned uncommitted sessions after the configured retention period.

- [ ] **Step 6: Add Web synchronization progress**

The peers/app UI posts the source sync request, subscribes to job events, displays state history, and offers cancellation before activation. It never sends the peer API key during synchronization.

- [ ] **Step 7: Run Server and Web tests**

Run: `pnpm -C packages/server exec vitest run tests/integration/two-peer-sync.test.ts && pnpm -C packages/web test`

Expected: PASS.

- [ ] **Step 8: Commit application synchronization**

```bash
git add packages/server packages/web
git commit -m "feat(sync): add atomic application peer sync"
```

---

### Task 8: Add explicit application-plus-data snapshot replacement

**Files:**
- Create: `packages/server/src/lib/app-snapshot.ts`
- Create: `packages/server/tests/integration/two-peer-data-sync.test.ts`
- Modify: `packages/server/src/lib/app-sync-source.ts`
- Modify: `packages/server/src/lib/app-sync-target.ts`
- Modify: `packages/server/src/lib/app-data-maintenance.ts`
- Modify: `packages/server/src/routes/sync.ts`
- Modify: `packages/web/components/peers/peers-page.tsx`
- Modify: `packages/web/components/peers/peers-page.test.tsx`

**Interfaces:**
- Produces: `createConsistentAppSnapshot(appDir): Promise<AppSnapshot>`.
- Produces: `replaceAppDataFromSnapshot(input): Promise<void>` with verified rollback.
- Extends source sync body with `{ withData: true; confirmation: appName }`.

- [ ] **Step 1: Write failing data replacement and rollback tests**

```ts
it("replaces target business data and files without replacing users or platform data", async () => {
  await seedSourceData({ row: "source", file: "source.pdf" });
  await seedTargetData({ row: "target", file: "target.pdf", issue: "keep-platform" });

  const job = await sourceSync("notes", { peerId, withData: true, confirmation: "notes" });
  await expectJob(job.id, "completed");

  expect(await targetRows()).toEqual([{ id: "source" }]);
  expect(await targetFiles()).toEqual(["source.pdf"]);
  expect(await targetIssues()).toContain("keep-platform");
  expect(await targetUsers()).toContain("target-owner");
});

it("restores version, database, and files when activation fails", async () => {
  injectFailure("activating");
  const job = await sourceSync("notes", { peerId, withData: true, confirmation: "notes" });
  await expectJob(job.id, "rolled-back");
  expect(await targetStateDigest()).toBe(originalTargetDigest);
});
```

- [ ] **Step 2: Run the data-sync test and verify RED**

Run: `pnpm -C packages/server exec vitest run tests/integration/two-peer-data-sync.test.ts`

Expected: FAIL because consistent snapshots and replacement do not exist.

- [ ] **Step 3: Implement source snapshot creation**

Acquire the existing application write guard, checkpoint/export the sql.js database, copy uploaded files into a staging tree, write a manifest of relative paths/sizes/digests, archive it, then release the source write guard. Exclude platform databases and configuration by an explicit allowlist of business database and application file roots.

- [ ] **Step 4: Implement target backup, replacement, and verified rollback**

Validate the complete snapshot before pausing target writes. Back up current version metadata, business database, and file root. Replace all three through staged paths, run integrity and application health checks, and resume writes only after success. On failure, restore and hash-verify every backup. Enter `recovery-required` if verification fails.

- [ ] **Step 5: Add explicit Web confirmation**

Require the application name to be typed before enabling `应用 + 数据`. Display that target data and files are replaced while users, permissions, issues, favorites, notifications, tasks, and messages remain local.

- [ ] **Step 6: Run data, backup, and failure tests**

Run: `pnpm -C packages/server exec vitest run tests/integration/two-peer-data-sync.test.ts tests/integration/app-data-management.test.ts tests/integration/upload-atomic-migrations.test.ts && pnpm -C packages/web test`

Expected: PASS.

- [ ] **Step 7: Commit data synchronization**

```bash
git add packages/server packages/web
git commit -m "feat(sync): add verified application data replacement"
```

---

### Task 9: Publish a standalone Node Server artifact

**Files:**
- Create: `packages/server/scripts/build-server-package.mjs`
- Create: `packages/server/scripts/build-server-package.node-test.mjs`
- Modify: `packages/server/package.json`
- Modify: `packages/server/tsconfig.json`
- Modify: `packages/web/package.json`
- Modify: `package.json`

**Interfaces:**
- Produces: publishable `@localapp/server` package with bin `{ "localapp-server": "bin/localapp-server.mjs" }`.
- Produces: one release directory containing Server bundle, Web assets, sql.js WASM, package metadata, and digest manifest.
- Produces: `pnpm -C packages/server package` and `pnpm -C packages/server test:package`.

- [x] **Step 1: Write a failing package acceptance test**

```js
test("packed Node Server initializes and serves Web without repository dependencies", async () => {
  const artifact = await buildServerPackage({ outputDirectory });
  const child = spawn(process.execPath, [artifact.bin, "start", "--data-dir", dataDir, "--port", "0"]);
  const ready = await readReadyLine(child.stdout);
  assert.equal((await fetch(`${ready.url}/health`)).status, 200);
  assert.match(await fetch(ready.setupUrl).then(r => r.text()), /Create|admin|管理员/i);
  assert.ok(await fileExists(path.join(dataDir, "jwt.key")));
});
```

- [x] **Step 2: Run the package test and verify RED**

Run: `node --test packages/server/scripts/build-server-package.node-test.mjs`

Expected before implementation: FAIL because no standalone package builder or bin exists; the acceptance test is now green.

- [x] **Step 3: Build one self-contained release directory**

Use esbuild to bundle the CLI and worker into CJS implementation files behind the `bin/localapp-server.mjs` launcher, copy `packages/web/out`, copy sql.js JS/WASM runtime files, write a minimal publishable `package.json`, and write `.localapp-server-artifact.json` containing version and SHA-256 digests. Do not include source, tests, Desktop assets, or Local Runtime.

- [x] **Step 4: Make package scripts deterministic**

`pnpm -C packages/server package` must build Server Core, Web, Server, and the release directory from a clean output path. Running it twice from the same commit must produce the same application-bundle digest.

- [x] **Step 5: Run clean package E2E**

Run: `pnpm -C packages/server package && pnpm -C packages/server test:package`

Expected: PASS after building into the project `tmp/` directory and starting with `NODE_PATH` cleared; only the bundled artifact and its included sql.js runtime are used.

- [x] **Step 6: Commit Node distribution**

```bash
git add packages/server packages/web/package.json package.json
git commit -m "build(server): publish standalone Node distribution"
```

---

### Task 10: Move generic Device Actions into the canonical Server and SDK

**Files:**
- Create: `packages/server/src/lib/device-action-types.ts`
- Rename: `packages/server/src/lib/desktop-actions-db.ts` to `packages/server/src/lib/device-action-source-store.ts`
- Create: `packages/server/src/lib/device-action-local-store.ts`
- Create: `packages/server/src/lib/device-action-ticket.ts`
- Create: `packages/server/src/lib/device-action-client.ts`
- Create: `packages/server/src/lib/device-action-trust-store.ts`
- Create: `packages/server/src/lib/device-action-executor.ts`
- Rename: `packages/server/src/routes/desktop-actions.ts` to `packages/server/src/routes/device-actions.ts`
- Create: `packages/server/src/routes/device-control.ts`
- Rename: `packages/sdk-core/src/desktop.ts` to `packages/sdk-core/src/device.ts`
- Rename: `packages/sdk-react/src/hooks/use-desktop-action.ts` to `packages/sdk-react/src/hooks/use-device-action.ts`
- Create: `packages/server/tests/device-action-ticket.test.ts`
- Create: `packages/server/tests/device-action-trust.test.ts`
- Create: `packages/server/tests/device-action-executor.test.ts`
- Create: `packages/server/tests/device-action-source-policy.test.ts`
- Rename: `packages/server/tests/desktop-actions-db.test.ts` to `packages/server/tests/device-action-source-store.test.ts`
- Rename: `packages/server/tests/integration/desktop-actions.test.ts` to `packages/server/tests/integration/device-actions.test.ts`
- Create: `packages/server/tests/integration/two-server-device-action.test.ts`
- Create: `packages/web/app/(dashboard)/my/device-actions/page.tsx`
- Create: `packages/web/components/device-actions/device-actions-page.tsx`
- Create: `packages/web/components/device-actions/device-actions-page.test.tsx`
- Modify: `packages/server/src/server.ts`
- Modify: `packages/server/src/lib/config.ts`
- Modify: `packages/server/package.json`
- Modify: `packages/sdk-core/src/index.ts`
- Modify: `packages/sdk-core/tests/desktop.test.ts`
- Modify: `packages/sdk-react/src/index.ts`
- Modify: `packages/sdk-react/tests/use-desktop-action.test.tsx`
- Modify: `packages/web/components/app-shell.tsx`

**Interfaces:**
- Produces `DeviceActionRequest`, `DeviceActionPermissionSet`, `DeviceActionSnapshot`, and `DeviceActivationTicket` in `device-action-types.ts`:

```ts
export interface DeviceActionPermissionSet {
  filesystemRead?: string[];
  filesystemWrite?: string[];
  network?: boolean;
  childProcess?: boolean;
}

export interface DeviceActionRequest {
  title: string;
  description?: string;
  script: string;
  dependencies?: Record<string, string>;
  input?: unknown;
  permissions: DeviceActionPermissionSet;
  timeoutSeconds?: number;
}

export interface DeviceActivationTicket {
  protocolVersion: 2;
  sourceOrigin: string;
  actionId: string;
  nonce: string;
}
```

- Produces SDK exports `device.run(request, options)`, `device.get(requestId)`, and React `useDeviceAction()`; removes the Desktop-named public exports without compatibility aliases.
- Produces source application endpoint `POST /serve/:owner/:app/api/device-actions`, source claim endpoint `POST /api/device-actions/:id/claim`, action-scoped `POST /api/device-actions/:id/status`, authenticated user status/SSE endpoints, and cancellation.
- Produces loopback-only bridge endpoint `POST /api/device-control/activations`, enabled only when `LOCALAPP_DEVICE_CONTROL_TOKEN` is present and requiring `x-localapp-device-control`. Its response may include only a confirmation URL under the exact local ready origin and `/my/device-actions/` path.
- Produces local administrator endpoints under `/api/device-actions/local` for pending actions, exact trust grants, revocation, logs, and cancellation.
- Consumes `packages/server/runner/localapp-runner.mjs`, the bundled Node executable, the Server master key, and Server-owned `<data-dir>/device-actions` directories.

- [ ] **Step 1: Write failing protocol, trust, and two-Server tests**

```ts
it("hands a source action to the Server on the computer that receives the activation", async () => {
  const created = await createHostedDeviceAction(source, {
    title: "Install fixture",
    script: "await import('node:fs/promises').then(fs => fs.writeFile(input.path, input.content)); return { installed: true };",
    input: { path: installPath, content: "fixture" },
    permissions: { filesystemWrite: [installPath] },
  });

  expect(created.activationUrl).toMatch(/^localapp:\/\/action\//);
  expect(created.activationUrl).not.toContain("writeFile");
  await activateOnLocalServer(local, created.activationUrl, controlToken);
  expect(await localPendingAction(created.requestId)).toMatchObject({ status: "awaiting_trust" });
  await trustLocalAction(local, created.requestId, localAdminSession);
  await expectSourceAction(source, created.requestId, "succeeded");
  expect(await readFile(installPath, "utf8")).toBe("fixture");
});

it("requires new confirmation when permissions expand", async () => {
  await trustAndRun({ permissions: { filesystemWrite: [firstPath] } });
  expect((await activate({ permissions: { filesystemWrite: [firstPath] } })).status).toBe("preparing");
  expect((await activate({ permissions: { filesystemWrite: [firstPath, secondPath] } })).status).toBe("awaiting_trust");
});
```

- [ ] **Step 2: Run Device Action tests and verify RED**

Run: `pnpm -C packages/server exec vitest run tests/device-action-ticket.test.ts tests/device-action-trust.test.ts tests/device-action-executor.test.ts tests/device-action-source-policy.test.ts tests/integration/two-server-device-action.test.ts`

Expected: FAIL because generic tickets, local activation, permission-aware trust, and Server-owned execution do not exist.

- [ ] **Step 3: Generalize and harden the source action protocol**

Rename the Desktop-specific stores and routes. Canonicalize and bound every request field, derive publisher identity from the active installed application version, and persist a canonical permission JSON plus SHA-256 digest. Return `localapp://action/<canonical-uuid>?origin=<percent-encoded-origin>&nonce=<base64url>&protocolVersion=2`; reject duplicate or unknown query fields. Keep script, dependencies, and input out of browser status responses and Scheme URLs.

Derive the activation origin from canonical Server configuration, never request `Host` or untrusted forwarding headers. Accept only registry package names with exact versions in dependencies; reject URL, Git, file, workspace, tag, alias, and range specifications. Bound action/request/result/log sizes and timeouts before persistence.

Claim uses the high-entropy nonce and local installation ID, atomically binds the action to one installation, and returns the action plus an action-scoped callback token. Encrypt that token with the Server master key so the identical installation can retry a lost claim response. Status updates accept only the callback token and bound installation ID; neither the source user's API key nor a synchronized identity is involved.

- [ ] **Step 4: Implement authenticated local activation and durable claim**

Register `device-control` only when the injected control token is non-empty. Require a loopback socket address, constant-time token comparison, JSON content type, protocol version 2, and a strictly normalized source origin. Persist the activation before returning. The local worker claims only a fixed endpoint with redirects, ambient proxy variables, cookies, and authentication disabled; enforce connect/total timeouts, response bounds, DNS/address revalidation, HTTPS by default, loopback HTTP for development, and private-network HTTP only after explicit local-admin opt-in. It verifies action ID, origin, publisher fields, permissions digest, expiry, and callback credential, then durably records the claimed payload before any trust or execution transition.

- [ ] **Step 5: Implement permission-aware trust and the local Web surface**

Store grants by `(sourceOrigin, appOwner, appName, publisherUserId, permissionsDigest)`. Canonical permission arrays are absolute, normalized, sorted, and duplicate-free. Reuse searches the same origin/application/publisher tuple and accepts an existing grant only when its stored permission set contains the new set. A source, application, publisher, or expanded path/boolean permission enters `awaiting_trust`. Only a local administrator may grant or revoke. Add `/my/device-actions` for pending confirmation, active/history state, exact permission display, trust revocation, cancellation, and local logs; it is a normal static-exported Server Web page, not a Tauri window.

- [ ] **Step 6: Move script execution and dependency preparation into Server**

Port only the generic behavior from Desktop's execution, runner, environment, and process tests. Prepare exact registry dependencies under a content-addressed Server cache with lifecycle scripts disabled and verified lockfile/integrity metadata. Launch the immutable Server runner with the bundled/current Node executable and `--permission`; always allow the runner, action module, dependency directory, and Server-created working directory, then add requested filesystem roots and `--allow-net`, `--allow-child-process`, or `--allow-worker` only when declared. Resolve existing ancestors and reject/recheck symlink escapes for filesystem grants. Supply a minimal environment that omits JWT, master key, peer keys, API keys, proxy variables, and inherited credential-like names. Persist bounded stdout/stderr, input, and result, enforce timeout, cancel the whole process tree, and recover claimed nonterminal records as `interrupted` unless they had not started and can safely resume preparation.

- [ ] **Step 7: Rename the public SDK without narrowing the application contract**

Keep the existing EventSource-with-polling fallback and abort behavior. Replace `desktop.run` with `device.run`, replace `useDesktopAction` with `useDeviceAction`, add the mandatory permission declaration, and preserve generic script/dependency/input/result typing. No SKILL-specific field or installer API belongs in SDK or Server.

- [ ] **Step 8: Run Device Action, SDK, Web, and Server regression suites**

Run:

```bash
pnpm -C packages/server exec vitest run tests/device-action-ticket.test.ts tests/device-action-trust.test.ts tests/device-action-executor.test.ts tests/device-action-source-policy.test.ts tests/device-action-source-store.test.ts tests/integration/device-actions.test.ts tests/integration/two-server-device-action.test.ts
pnpm -C packages/sdk-core test
pnpm -C packages/sdk-react test
pnpm -C packages/web test
pnpm -C packages/web build
pnpm -C packages/server test
```

Expected: PASS; the two-Server test writes only inside its project-local fixture directory, a missing permission is denied, a replay is idempotent, and browser-visible responses contain no script or callback credential.

- [ ] **Step 9: Commit generic Device Actions**

```bash
git add -A packages/server packages/sdk-core packages/sdk-react packages/web
git commit -m "feat(server): add generic local device actions"
```

---

### Task 11: Replace Desktop with a windowless Scheme bridge and two-item tray

**Files:**
- Create: `packages/desktop/src-tauri/src/server_process.rs`
- Create: `packages/desktop/src-tauri/src/activation.rs`
- Create: `packages/desktop/src-tauri/src/device_control_client.rs`
- Create: `packages/desktop/src-tauri/tests/device_control.rs`
- Create: `packages/desktop/src-tauri/tests/tray_server.rs`
- Create: `packages/desktop/src-tauri/tests/activation.rs`
- Create: `packages/desktop/scripts/bundle-server.mjs`
- Create: `packages/desktop/scripts/bundle-server.node-test.mjs`
- Create: `packages/desktop/scripts/bundle-node-runtime.mjs`
- Replace: `packages/desktop/src-tauri/src/lib.rs`
- Modify: `packages/desktop/src-tauri/Cargo.toml`
- Modify: `packages/desktop/src-tauri/tauri.conf.json`
- Modify: `packages/desktop/package.json`
- Delete: `packages/desktop/src/**`
- Delete: `packages/desktop/src-tauri/src/agent/**`
- Delete: `packages/desktop/src-tauri/src/actions.rs`
- Delete: `packages/desktop/src-tauri/src/bus.rs`
- Delete: `packages/desktop/src-tauri/src/desktop_control.rs`
- Delete: `packages/desktop/src-tauri/src/execution.rs`
- Delete: `packages/desktop/src-tauri/src/local_app_commands.rs`
- Delete: `packages/desktop/src-tauri/src/local_apps.rs`
- Delete: `packages/desktop/src-tauri/src/local_platform.rs`
- Delete: `packages/desktop/src-tauri/src/local_runtime.rs`
- Delete: `packages/desktop/src-tauri/src/platform.rs`
- Delete: `packages/desktop/src-tauri/src/server_profiles.rs`
- Delete: `packages/desktop/src-tauri/src/settings.rs`
- Delete: `packages/desktop/src-tauri/src/studio_agent.rs`
- Delete: `packages/desktop/src-tauri/src/studio_commands.rs`
- Delete: `packages/desktop/src-tauri/src/studio_projects.rs`
- Delete: `packages/desktop/src-tauri/src/task_repository.rs`
- Delete: `packages/desktop/src-tauri/src/trust.rs`
- Delete: legacy Desktop React and Rust tests that assert removed behavior

**Interfaces:**
- Produces: `ServerProcess::start`, `ready`, `open_home`, `stop`, and `restart_after_failure`.
- Produces: strict `localapp://action/<uuid>?origin=<encoded-origin>&nonce=<base64url>&protocolVersion=2` parsing and loopback forwarding.
- Produces: `DeviceControlClient::activate(ticket)` authenticated by a random per-process `LOCALAPP_DEVICE_CONTROL_TOKEN` shared only with the child Server.
- Produces tray menu IDs `tray-open-home` and `tray-exit` only.
- Consumes the exact artifact from Task 9 and a pinned Node.js runtime under Tauri resources.

- [x] **Step 1: Write failing activation, tray-menu, and child-lifecycle tests**

```rust
#[test]
fn tray_menu_contains_only_open_home_and_exit() {
    assert_eq!(tray_menu_specs(), [
        ("tray-open-home", "打开主页"),
        ("tray-exit", "退出本地服务"),
    ]);
}

#[tokio::test]
async fn server_process_opens_ready_url_and_stops_child() {
    let mut process = ServerProcess::start(fixture_launch()).await.unwrap();
    let ready = process.ready().await.unwrap();
    assert!(ready.url.starts_with("http://127.0.0.1:"));
    process.stop().await.unwrap();
    assert!(!process.is_running());
}

#[test]
fn activation_ticket_rejects_scripts_credentials_and_extra_fields() {
    assert!(ActivationTicket::parse(
        "localapp://action/018f7c0e-0f8f-4b5f-8c20-7f468f808d10?origin=https%3A%2F%2Fapps.example&nonce=abcdefghijklmnop&protocolVersion=2"
    ).is_ok());
    assert!(ActivationTicket::parse(
        "localapp://action/018f7c0e-0f8f-4b5f-8c20-7f468f808d10?origin=https%3A%2F%2Fapps.example&nonce=abcdefghijklmnop&protocolVersion=2&script=evil"
    ).is_err());
}
```

- [x] **Step 2: Run tray tests and verify RED**

Run: `cargo test --manifest-path packages/desktop/src-tauri/Cargo.toml --test tray_server --test activation`

Expected: FAIL because the minimal menu, Scheme parser, loopback client, and unified Server process controller do not exist.

- [x] **Step 3: Implement the strict native activation bridge**

Keep `tauri-plugin-deep-link` and `tauri-plugin-single-instance`. Register `localapp://`, accept only the versioned Device Action ticket shape, reject source schemes other than HTTP(S), userinfo, fragments, control characters, unknown/duplicate fields, non-canonical UUIDs, non-base64url nonces, and any executable content or credential field. The bridge never fetches an action and never decides whether an HTTP origin is trusted; Task 10's local Server source policy makes that decision before network access.

Generate a cryptographically random control token for each Server child. Pass it only through `LOCALAPP_DEVICE_CONTROL_TOKEN`; do not persist or log it. Forward a parsed ticket to `POST http://127.0.0.1:<ready-port>/api/device-control/activations` in `x-localapp-device-control`. If activation arrives before readiness, start or await the child once, then forward. Duplicate OS deliveries are safe because the Server consumes the ticket idempotently. If the response contains a confirmation URL, open it only after verifying that its origin equals the child's ready origin and its normalized path is below `/my/device-actions/`.

- [x] **Step 4: Replace the Desktop application destructively**

Delete the React application and all Rust business modules listed above. Replace `lib.rs` with Tauri setup, Scheme registration, single-instance URL forwarding, Server child startup, two tray menu handlers, left-click open-home behavior, autostart/updater plugins, startup-failure notification, and graceful child termination on exit. There is no management window and no Rust action runner.

- [x] **Step 5: Remove the main window and unnecessary dependencies**

Set `app.windows` to `[]`, remove `beforeDevCommand`, `frontendDist`, WebView CSP, dialog/business plugins, React/Vite dependencies, database/task/runtime dependencies, and every generated command handler. Retain only the deep-link, single-instance, opener, autostart, updater, tray, notification, HTTP client, process, serialization, URL, and cryptography dependencies required by this bridge.

- [x] **Step 6: Bundle the exact Server release artifact**

`bundle-server.mjs` invokes Task 9's builder and copies its release directory to `src-tauri/resources/server`. `bundle-node-runtime.mjs` resolves the pinned, checksummed Node.js runtime for each Tauri target and places only the required executable and licenses under `src-tauri/resources/node/<target>`. The launcher invokes this bundled executable, never a Node installation from `PATH`. The Node test compares `.localapp-server-artifact.json` digests between both Server locations and verifies the bundled runtime reports the pinned Node major version.

- [x] **Step 7: Run native bridge build and tests**

Run: `pnpm -C packages/desktop test && cargo test --manifest-path packages/desktop/src-tauri/Cargo.toml && pnpm -C packages/desktop tauri build --debug --bundles app`

Expected: PASS; build metadata contains no window, resources contain Server rather than Local Runtime, the Scheme reaches only the authenticated loopback endpoint, and no execution/trust implementation remains in Rust.

The default macOS bundle set also creates a DMG; this host's DMG helper is unavailable, so the acceptance command explicitly builds the verified `.app` bundle.

- [x] **Step 8: Commit the native bridge**

```bash
git add -A packages/desktop
git commit -m "refactor(desktop): replace client with native server bridge"
```

---

### Task 12: Replace CLI publishing language and delete Local Runtime

**Files:**
- Create: `packages/cli/src/commands/app.rs`
- Create: `packages/cli/src/commands/peer.rs`
- Modify: `packages/cli/src/main.rs`
- Modify: `packages/cli/src/commands/mod.rs`
- Modify: `packages/cli/src/client.rs`
- Modify: `packages/cli/src/config.rs`
- Modify: `packages/cli/src/commands/check.rs`
- Delete: `packages/cli/src/commands/local.rs`
- Delete: `packages/cli/src/commands/upload.rs`
- Delete: `packages/cli/src/commands/desktop.rs`
- Delete: `packages/local-runtime/**`
- Modify: `pnpm-workspace.yaml`
- Modify: `README.md`
- Replace: `docs/local-runtime.md`
- Modify: release/export scripts that reference Local Runtime or full Desktop

**Interfaces:**
- Produces CLI commands `localapp app install --target <connection>`, `localapp app sync --peer <name>`, and `localapp app sync --peer <name> --with-data --confirm-app <name>`.
- Produces `ConnectionStore` for CLI-side named Server URLs and API Keys; `app install` uses the explicit target and `app sync` uses the active source connection unless `--target` is supplied.
- Removes `localapp desktop`, `localapp local install`, and `localapp upload` entirely.
- Removes `@localapp/local-runtime` from the pnpm workspace and dependency graph.

- [ ] **Step 1: Write failing CLI parser and request tests**

```rust
#[test]
fn parses_unified_app_commands_and_rejects_removed_commands() {
    assert!(Cli::try_parse_from(["localapp", "app", "install", "--target", "local"]).is_ok());
    assert!(Cli::try_parse_from(["localapp", "app", "sync", "--peer", "office", "--with-data", "--confirm-app", "notes"]).is_ok());
    assert!(Cli::try_parse_from(["localapp", "local", "install", "x.localapp"]).is_err());
    assert!(Cli::try_parse_from(["localapp", "upload"]).is_err());
}
```

- [ ] **Step 2: Run CLI tests and verify RED**

Run: `cargo test --manifest-path packages/cli/Cargo.toml parses_unified_app_commands`

Expected: FAIL because the old command tree is still present.

- [ ] **Step 3: Implement Server-targeted application commands**

`app install` builds the current project or reads an explicit `--package <path>` `.localapp` package and posts it to `/api/me/apps/install` using the selected connection API Key. `app sync` asks the active (or explicitly selected) source Server to start `/api/me/apps/:name/sync`; the peer name resolves inside that Server, so the target peer credential is never copied into CLI configuration. `--with-data` requires `--confirm-app <exact-name>` in non-interactive mode and an exact typed name in interactive mode.

- [ ] **Step 4: Delete old commands and Local Runtime**

Remove the command variants, modules, tests, workspace entry, bundle scripts, and documentation. Update root and release scripts so searching tracked files for `@localapp/local-runtime`, `localapp-local-runtime`, or `localapp local install` returns no production references.

- [ ] **Step 5: Rewrite product documentation around one Server and equal peers**

Document Node startup, the optional native bridge, first-run setup, loopback/LAN settings, application installation, peer API keys, application-only sync, explicit data sync, Device Action activation, and clean-state policy. Remove MiniServer, legacy upload, and Desktop-management terminology from user-facing workflows. Task 13 separately owns generated-application guidance.

- [ ] **Step 6: Run CLI, workspace, and documentation tests**

Run: `cargo test --manifest-path packages/cli/Cargo.toml && pnpm install --lockfile-only && pnpm -r build && pnpm -r test`

Expected: PASS with no Local Runtime workspace package.

- [ ] **Step 7: Commit the breaking CLI and package removal**

```bash
git add -A packages/cli packages/local-runtime pnpm-workspace.yaml pnpm-lock.yaml README.md docs init-repo scripts package.json
git commit -m "refactor: remove local runtime and legacy client workflows"
```

---

### Task 13: Upgrade the application template, media tooling, and agent guidance

**Files:**
- Modify: `AGENTS.md`
- Create: `init-repo/AGENTS.md`
- Modify: `init-repo/CLAUDE.md`
- Modify: `init-repo/package.json`
- Create: `init-repo/.npmrc`
- Modify: `init-repo/.claude/skills/localapp/SKILL.md`
- Modify: `init-repo/.claude/skills/localapp-upload/SKILL.md`
- Create: `init-repo/.claude/skills/localapp-device-actions/SKILL.md`
- Create: `init-repo/tests/media-preview-template.test.ts`
- Create: `init-repo/tests/agent-guidance-template.test.ts`
- Modify: `packages/localapp-template/src/lib.rs`
- Modify: `packages/localapp-template/tests/smoke_init.rs`

**Interfaces:**
- Newly initialized applications include `react-pdf@10.4.1`, `pdfjs-dist@6.1.200`, and `yet-another-react-lightbox@3.32.1`.
- pnpm projects receive `public-hoist-pattern[]=pdfjs-dist` so the PDF worker resolves consistently.
- Every generated repository exposes the same `AGENTS.md` guidance to coding agents and documents generic `device.run()` without SKILL-specific Server APIs.
- All local examples, generated apps, Server state, uploads, and downloads are placed below the repository `tmp/` directory.

- [ ] **Step 1: Write failing template dependency and guidance tests**

```ts
test("template includes supported PDF and image preview packages", () => {
  expect(template.dependencies["react-pdf"]).toBe("10.4.1");
  expect(template.dependencies["pdfjs-dist"]).toBe("6.1.200");
  expect(template.dependencies["yet-another-react-lightbox"]).toBe("3.32.1");
});

test("agent guidance uses the unified Server and generic Device Actions", () => {
  expect(guidance).toContain("device.run");
  expect(guidance).not.toMatch(/MiniServer|localapp upload|(^|[\s`"'(])\/tmp\//m);
});
```

- [ ] **Step 2: Run template tests and verify RED**

Run: `pnpm -C init-repo test && cargo test --manifest-path packages/localapp-template/Cargo.toml`

Expected: FAIL because media dependencies, `.npmrc`, generated `AGENTS.md`, and the Device Action skill do not exist.

- [ ] **Step 3: Add stable media-preview foundations**

Pin the three preview packages exactly. Configure the PDF.js worker from the installed `pdfjs-dist` asset in a Vite-safe way and document a reusable PDF preview component with loading/error states, page navigation, and object-URL cleanup. Document image preview with keyboard navigation, alt text, download, and object-URL cleanup. Do not add a Server-specific media renderer: application uploads remain ordinary file resources.

- [ ] **Step 4: Rewrite app-development instructions from real workflows**

Replace MiniServer, `localapp upload`, `/tmp`, and raw `/serve/` navigation instructions with one Server, `localapp app install --target`, formal `/<owner>/<app>/` URLs, repository-local `tmp/`, and Browser self-verification. Explain that Device Actions are privileged current-computer operations: declare the narrowest permissions, keep scripts deterministic, display the operation before activation, and treat child-process permission as full current-user code execution.

The Device Action skill contains a generic example that writes an explicitly selected file and reports a typed result. SKILL catalog metadata, install layouts, and target-tool adapters remain outside this skill because they belong to consumer applications.

- [ ] **Step 5: Ensure builtin initialization copies every new artifact**

Update the embedded-template package and smoke tests so `localapp init` emits `.npmrc`, `AGENTS.md`, the Device Action skill, media dependencies, migrations, and runtime files byte-for-byte. Initialize a fixture under `<repo>/tmp/template-smoke`, install dependencies, and build it without reaching into the source template.

- [ ] **Step 6: Run template, CLI-init, and workspace checks**

Run:

```bash
pnpm -C init-repo test
pnpm -C init-repo build
cargo test --manifest-path packages/localapp-template/Cargo.toml
cargo test --manifest-path packages/cli/Cargo.toml init
git diff --check
```

Expected: PASS, and the generated fixture resolves both PDF and image preview packages without warnings or source-template path dependencies.

- [ ] **Step 7: Commit template and agent guidance**

```bash
git add AGENTS.md init-repo packages/localapp-template
git commit -m "feat(template): add device actions and media preview guidance"
```

---

### Task 14: Generate, publish, and exercise two realistic local applications

**Files:**
- Create: `examples/skill-market/**`
- Create: `examples/skill-market/ACCEPTANCE.md`
- Create: `examples/resume-manager/**`
- Create: `examples/resume-manager/ACCEPTANCE.md`
- Create: `packages/server/tests/e2e-unified/real-apps.spec.ts`
- Create: `packages/server/tests/e2e-unified/fixtures/fixture-skill/SKILL.md`
- Create: `packages/server/tests/e2e-unified/fixtures/portrait.png`
- Create: `packages/server/tests/e2e-unified/fixtures/resume.pdf`
- Modify: `package.json`
- Modify: `pnpm-workspace.yaml`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Both applications originate from the real builtin `localapp init` template and are installed through the formal package installer; they are not test-only static HTML fixtures.
- The SKILL marketplace calls only generic SDK `device.run()` and installs the fixture into `<repo>/tmp/unified-acceptance/installed-skills/<skill-name>` on the computer where the user clicks.
- The resume manager uses Named SQL and the upload API, previews uploaded images and PDFs, and downloads the original bytes through authenticated application APIs.
- Produces `pnpm test:real-apps` for deterministic non-Browser setup and assertions.

- [ ] **Step 1: Write failing real-application acceptance tests**

```ts
test("skill market publishes a narrowly scoped local install action", async () => {
  const action = await createSkillInstallAction(skillMarket, installRoot);
  expect(action.permissions.filesystemWrite).toEqual([installRoot]);
  expect(action.permissions.childProcess).toBe(false);
  expect(action.activationUrl).toMatch(/^localapp:\/\/action\//);
});

test("resume manager preserves upload, preview, and download bytes", async () => {
  const image = await uploadResumeAsset("portrait.png");
  const pdf = await uploadResumeAsset("resume.pdf");
  expect(await download(image)).toEqual(fixtureBytes("portrait.png"));
  expect(await download(pdf)).toEqual(fixtureBytes("resume.pdf"));
});
```

- [ ] **Step 2: Run real-application tests and verify RED**

Run: `pnpm test:real-apps`

Expected: FAIL because neither generated application nor its end-to-end contract exists.

- [ ] **Step 3: Generate and implement the SKILL marketplace application**

Initialize from the builtin template into `examples/skill-market`, then use the generated skills and `AGENTS.md` while implementing. Provide catalog cards, SKILL detail, selected install root, exact permission disclosure, install state, action result, and failure recovery. The install script validates a bounded relative SKILL name, creates the selected directory, writes the fixture `SKILL.md` atomically, and returns installed paths and digest. It never assumes Codex, Claude, or another target tool in Server code.

- [ ] **Step 4: Generate and implement the resume manager application**

Initialize from the builtin template into `examples/resume-manager`, then implement resume records, upload controls, authenticated image/PDF retrieval, inline image lightbox, PDF page preview, original-file download, replacement, deletion, loading/error/empty states, and durable metadata through Named SQL. Include tiny deterministic image and PDF fixtures whose license permits repository inclusion.

- [ ] **Step 5: Build, package, and install both applications locally**

Start two clean loopback Servers below `<repo>/tmp/unified-acceptance`: a source Web Server and the current-computer Server supervised through the native bridge contract. Initialize administrators, build both applications, install their `.localapp` packages on the source, and record formal URLs from Server responses. Do not hand-edit installed files or use raw `/serve/` routes as the product URL.

- [ ] **Step 6: Exercise nonvisual contracts and persist reproducible fixtures**

Use the source APIs to create an install action and the local control endpoint to claim it; explicitly grant the first publisher as local admin; assert the fixture SKILL bytes appear only below the selected repository-local target. Upload image/PDF fixtures to the resume manager, assert database metadata, content type, byte-for-byte download, authorization boundaries, and deletion. Leave Browser-only assertions for Task 15.

- [ ] **Step 7: Run both application suites and commit**

Run:

```bash
pnpm -C examples/skill-market test
pnpm -C examples/skill-market build
pnpm -C examples/resume-manager test
pnpm -C examples/resume-manager build
pnpm test:real-apps
git diff --check
```

Expected: PASS; both packages are installed and usable through formal local application URLs, while generated runtime state remains ignored below `tmp/`.

```bash
git add examples packages/server/tests/e2e-unified package.json pnpm-lock.yaml pnpm-workspace.yaml
git commit -m "feat(examples): add skill market and resume manager"
```

---

### Task 15: Run cross-distribution acceptance and Browser self-verification

**Files:**
- Create: `packages/server/tests/e2e-unified/two-peer.spec.ts`
- Create: `packages/server/tests/e2e-unified/studio-task.spec.ts`
- Create: `packages/server/tests/e2e-unified/tray-artifact.node-test.mjs`
- Create: `packages/server/tests/e2e-unified/device-action-bridge.spec.ts`
- Create: `docs/verification/2026-08-10-unified-local-acceptance.md`
- Modify: `playwright.config.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes the packaged Node Server and packaged tray Server artifact.
- Consumes the two applications from Task 14.
- Produces `pnpm test:unified-acceptance` and a checked local Browser acceptance record.

- [ ] **Step 1: Write failing packaged-artifact acceptance tests**

The tests must start two clean Server artifacts below `<repo>/tmp`, complete first-admin setup for each, create target API keys, install an application on source, configure the target peer, run application-only sync, seed divergent target data, run data sync, and assert users/platform data remain independent. They also launch the packaged native bridge's Server artifact, inject a versioned Scheme ticket through its Rust forwarding boundary, and assert exactly one local Device Action result reaches the source.

```ts
test("two clean packaged peers synchronize code and explicitly replace data", async ({ page }) => {
  await initializePeer(source, "source-admin");
  await initializePeer(target, "target-admin");
  await installFixtureApp(source, "interview-app");
  await configurePeer(source, target, "target-admin");
  await syncApp(source, "interview-app", false);
  await expectAppHeading(target, "target-admin", "interview-app", "面试管理");
  await syncApp(source, "interview-app", true);
  await expectIndependentUsersAndPlatformData(source, target);
});
```

- [ ] **Step 2: Run acceptance tests and verify RED**

Run: `pnpm test:unified-acceptance`

Expected: FAIL until every packaged route, Web page, and distribution artifact is wired together.

- [ ] **Step 3: Fix only integration gaps exposed by acceptance tests**

Do not add compatibility adapters. Correct package paths, static Web routes, readiness output, cookie/public URL behavior, synchronization progress, Device Action handoff, and tray artifact selection in the owning modules from prior tasks.

- [ ] **Step 4: Run the full automated verification matrix**

Run:

```bash
pnpm -C packages/server-core build
pnpm -C packages/server test
pnpm -C packages/web test
pnpm -C packages/web build
pnpm -C packages/server package
pnpm -C packages/server test:package
cargo test --manifest-path packages/cli/Cargo.toml
cargo test --manifest-path packages/desktop/src-tauri/Cargo.toml
pnpm -C packages/desktop test
pnpm test:unified-acceptance
pnpm test:real-apps
pnpm -r build
git diff --check
```

Expected: every command exits `0` with no unexpected warnings or skipped required suites.

- [ ] **Step 5: Verify the complete SKILL marketplace flow in the application Browser**

Start the packaged source Server and native bridge locally under `<repo>/tmp/unified-acceptance`. Use the explicitly required `browser:control-in-app-browser` skill, read its in-app Browser documentation once, and interact only through visible/semantic Browser state. Log in, open the formal SKILL marketplace URL, inspect a SKILL, click install, follow the `localapp://` activation, approve first-publisher trust in the local Server Web page, and observe success in the source page. Assert the expected `SKILL.md` exists below `<repo>/tmp/unified-acceptance/installed-skills` with the expected digest, a repeated identical action does not re-prompt, and an expanded permission does re-prompt. Capture page state and check browser errors/warnings after each major transition.

- [ ] **Step 6: Verify resume upload, previews, and download in the application Browser**

Using the same in-app Browser and formal application URL, open the resume manager, create a resume, upload the deterministic PNG and PDF fixtures, open the image lightbox, navigate/render the PDF preview, download both originals into `<repo>/tmp/unified-acceptance/downloads`, and compare their bytes with the fixtures. Refresh and log in again to prove metadata and content persist. Verify replacement/deletion and an unauthorized file request. Confirm there is no blank page, failed module request, uncaught exception, or browser error/warn log.

- [ ] **Step 7: Verify the Server Web control plane and two-peer synchronization in the application Browser**

Use the in-app Browser to verify first setup, login, users, applications, Studio, task execution, peers, application-only sync, explicit app-plus-data confirmation, backup/rollback status, Device Action history/trust revocation, and LAN setting presentation. Confirm application resources load under `/serve/<owner>/<app>/` while navigation uses `/<owner>/<app>/`. Re-run both apps after synchronization.

- [ ] **Step 8: Verify the destructive-removal boundary**

Run:

```bash
test ! -e packages/local-runtime
test ! -d packages/desktop/src
rg -n "@localapp/local-runtime|localapp-local-runtime|localapp local install|Commands::Upload|MiniServer|localapp upload" packages pnpm-workspace.yaml README.md init-repo scripts AGENTS.md --glob '!**/tests/**'
```

Expected: the first two checks succeed and `rg` returns no production references. Historical specifications/plans and deletion assertions in tests are intentionally outside this production scan.

- [ ] **Step 9: Request final code review and resolve every finding**

Request a fresh, most-capable reviewer over the complete design, plan, commit range, two packaged distributions, Device Action threat boundary, sync rollback behavior, and both application journeys. For each actionable finding, write a reproducing test first, apply the smallest owning-module fix, rerun the focused and full matrices, and repeat review until no findings remain.

- [ ] **Step 10: Commit acceptance coverage and final integration fixes**

```bash
git add -A
git commit -m "test: verify unified server distributions end to end"
```

- [ ] **Step 11: Stop local processes and preserve the acceptance record**

Stop both packaged Servers and the native bridge gracefully. Keep committed source fixtures and the Browser acceptance record; remove only generated runtime subdirectories below `<repo>/tmp/unified-acceptance` after byte comparisons and log capture are complete. Never touch unrelated user content already present under `tmp/`.

# Unified Server and Optional Tray Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the separate Local Runtime and full Desktop client with one distributable Node Server, one Server-hosted Web control plane, peer application synchronization, and an optional two-item tray launcher.

**Architecture:** `@localapp/server` becomes a reusable Fastify application plus a supervised `localapp-server` executable. Every deployment runs the same Server bundle and Web assets; configuration selects listener and storage providers. Server-owned workspaces, tasks, peers, and synchronization are implemented as focused services and routes. The Tauri package becomes a windowless process launcher that bundles the exact Server artifact.

**Tech Stack:** Node.js 24+, TypeScript, Fastify 4, Next.js 15 static export, Vitest 4, Playwright, sql.js, Rust 2024, Tauri 2, pnpm, Cargo.

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
- The primary distribution is the Node package; the optional Tauri tray has no window and exactly `打开主页` and `退出本地服务`.
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
- Create: `packages/server/scripts/server-package-e2e.mjs`
- Modify: `packages/server/package.json`
- Modify: `packages/server/tsconfig.json`
- Modify: `packages/web/package.json`
- Modify: `package.json`

**Interfaces:**
- Produces: publishable `@localapp/server` package with bin `{ "localapp-server": "bin/localapp-server.mjs" }`.
- Produces: one release directory containing Server bundle, Web assets, sql.js WASM, package metadata, and digest manifest.
- Produces: `pnpm -C packages/server package` and `pnpm -C packages/server test:package`.

- [ ] **Step 1: Write a failing package acceptance test**

```js
test("packed Node Server initializes and serves Web without repository dependencies", async () => {
  const artifact = await buildServerPackage({ outputDirectory });
  const child = spawn(process.execPath, [artifact.bin, "start", "--data-dir", dataDir, "--port", "0"]);
  const ready = await readReadyLine(child.stdout);
  assert.equal((await fetch(`${ready.url}/health`)).status, 200);
  assert.match(await fetch(ready.setupUrl).then(r => r.text()), /创建管理员/);
  assert.ok(await fileExists(path.join(dataDir, "secrets", "jwt.key")));
});
```

- [ ] **Step 2: Run the package test and verify RED**

Run: `node --test packages/server/scripts/build-server-package.node-test.mjs`

Expected: FAIL because no standalone package builder or bin exists.

- [ ] **Step 3: Build one self-contained release directory**

Use esbuild to bundle `cli.ts` and `worker.ts`, copy `packages/web/out`, copy sql.js WASM, write a minimal publishable `package.json`, and write `.localapp-server-artifact.json` containing version and SHA-256 digests. Do not include source, tests, Desktop assets, or Local Runtime.

- [ ] **Step 4: Make package scripts deterministic**

`pnpm -C packages/server package` must build Server Core, Web, Server, and the release directory from a clean output path. Running it twice from the same commit must produce the same application-bundle digest.

- [ ] **Step 5: Run clean package E2E**

Run: `pnpm -C packages/server package && pnpm -C packages/server test:package`

Expected: PASS after copying the artifact to a temporary directory with no workspace `node_modules` lookup.

- [ ] **Step 6: Commit Node distribution**

```bash
git add packages/server packages/web/package.json package.json
git commit -m "build(server): publish standalone Node distribution"
```

---

### Task 10: Replace Desktop with a windowless two-item tray launcher

**Files:**
- Create: `packages/desktop/src-tauri/src/server_process.rs`
- Create: `packages/desktop/src-tauri/tests/tray_server.rs`
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
- Produces tray menu IDs `tray-open-home` and `tray-exit` only.
- Consumes the exact artifact from Task 9 and a pinned Node.js runtime under Tauri resources.

- [ ] **Step 1: Write failing tray-menu and child-lifecycle tests**

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
```

- [ ] **Step 2: Run tray tests and verify RED**

Run: `cargo test --manifest-path packages/desktop/src-tauri/Cargo.toml tray_server`

Expected: FAIL because the minimal menu and unified Server process controller do not exist.

- [ ] **Step 3: Replace the Desktop application destructively**

Delete the React application and all Rust business modules listed above. Replace `lib.rs` with Tauri setup, single-instance handling, server child startup, two tray menu handlers, left-click open-home behavior, autostart/updater plugins, and graceful child termination on exit.

- [ ] **Step 4: Remove the main window and unnecessary dependencies**

Set `app.windows` to `[]`, remove `beforeDevCommand`, `frontendDist`, WebView CSP, dialog/deep-link/business plugins, React/Vite dependencies, database/HTTP/task dependencies no longer used by the launcher, and every generated command handler.

- [ ] **Step 5: Bundle the exact Server release artifact**

`bundle-server.mjs` invokes Task 9's builder and copies its release directory to `src-tauri/resources/server`. `bundle-node-runtime.mjs` resolves the pinned, checksummed Node.js runtime for each Tauri target and places only the required executable and licenses under `src-tauri/resources/node/<target>`. The launcher invokes this bundled executable, never a Node installation from `PATH`. The Node test compares `.localapp-server-artifact.json` digests between both Server locations and verifies the bundled runtime reports the pinned Node major version.

- [ ] **Step 6: Run tray build and tests**

Run: `pnpm -C packages/desktop test && cargo test --manifest-path packages/desktop/src-tauri/Cargo.toml && pnpm -C packages/desktop tauri build --debug`

Expected: PASS; build metadata contains no window and resources contain Server rather than Local Runtime.

- [ ] **Step 7: Commit the tray-only launcher**

```bash
git add -A packages/desktop
git commit -m "refactor(desktop): replace client with server tray"
```

---

### Task 11: Replace CLI publishing language and delete Local Runtime

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
- Modify: `init-repo/CLAUDE.md`
- Modify: release/export scripts that reference Local Runtime or full Desktop

**Interfaces:**
- Produces CLI commands `localapp app install --target <connection>`, `localapp app sync --peer <name>`, and `localapp app sync --peer <name> --with-data`.
- Produces `ConnectionStore` for CLI-side named Server URLs and API Keys; `app install` uses the explicit target and `app sync` uses the active source connection unless `--target` is supplied.
- Removes `localapp desktop`, `localapp local install`, and `localapp upload` entirely.
- Removes `@localapp/local-runtime` from the pnpm workspace and dependency graph.

- [ ] **Step 1: Write failing CLI parser and request tests**

```rust
#[test]
fn parses_unified_app_commands_and_rejects_removed_commands() {
    assert!(Cli::try_parse_from(["localapp", "app", "install", "--target", "local"]).is_ok());
    assert!(Cli::try_parse_from(["localapp", "app", "sync", "--peer", "office", "--with-data"]).is_ok());
    assert!(Cli::try_parse_from(["localapp", "local", "install", "x.localapp"]).is_err());
    assert!(Cli::try_parse_from(["localapp", "upload"]).is_err());
}
```

- [ ] **Step 2: Run CLI tests and verify RED**

Run: `cargo test --manifest-path packages/cli/Cargo.toml parses_unified_app_commands`

Expected: FAIL because the old command tree is still present.

- [ ] **Step 3: Implement Server-targeted application commands**

`app install` builds or reads a `.localapp` package and posts it to `/api/me/apps/install` using the selected connection API Key. `app sync` asks the active (or explicitly selected) source Server to start `/api/me/apps/:name/sync`; the peer name resolves inside that Server, so the target peer credential is never copied into CLI configuration. `--with-data` requires an exact application-name confirmation flag in non-interactive mode.

- [ ] **Step 4: Delete old commands and Local Runtime**

Remove the command variants, modules, tests, workspace entry, bundle scripts, and documentation. Update root and release scripts so searching tracked files for `@localapp/local-runtime`, `localapp-local-runtime`, or `localapp local install` returns no production references.

- [ ] **Step 5: Rewrite documentation around one Server and equal peers**

Document Node startup, optional Tray, first-run setup, loopback/LAN settings, application installation, peer API keys, application-only sync, explicit data sync, and clean-state policy. Remove publish/management terminology from user-facing workflows.

- [ ] **Step 6: Run CLI, workspace, and documentation tests**

Run: `cargo test --manifest-path packages/cli/Cargo.toml && pnpm install --lockfile-only && pnpm -r build && pnpm -r test`

Expected: PASS with no Local Runtime workspace package.

- [ ] **Step 7: Commit the breaking CLI and package removal**

```bash
git add -A packages/cli packages/local-runtime pnpm-workspace.yaml pnpm-lock.yaml README.md docs init-repo scripts package.json
git commit -m "refactor: remove local runtime and legacy client workflows"
```

---

### Task 12: Run cross-distribution acceptance and Browser self-verification

**Files:**
- Create: `packages/server/tests/e2e-unified/two-peer.spec.ts`
- Create: `packages/server/tests/e2e-unified/studio-task.spec.ts`
- Create: `packages/server/tests/e2e-unified/tray-artifact.node-test.mjs`
- Modify: `playwright.config.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes the packaged Node Server and packaged tray Server artifact.
- Produces `pnpm test:unified-acceptance`.

- [ ] **Step 1: Write failing packaged-artifact acceptance tests**

The tests must start two clean Server artifacts, complete first-admin setup for each, create target API keys, install an application on source, configure the target peer, run application-only sync, seed divergent target data, run data sync, and assert users/platform data remain independent.

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

Do not add compatibility adapters. Correct package paths, static Web routes, readiness output, cookie/public URL behavior, synchronization progress, and tray artifact selection in the owning modules from prior tasks.

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
pnpm -r build
git diff --check
```

Expected: every command exits `0` with no unexpected warnings or skipped required suites.

- [ ] **Step 5: Perform application-in-Browser self-verification**

Start the packaged Server under `<repo>/tmp/unified-acceptance`, initialize the first admin, install the fixture application, and use the `browser:control-in-app-browser` skill to verify the Web home, Studio, tasks, peers, users, and the formal application URL. Confirm loaded module resources use `/serve/<owner>/<app>/`, application content renders, and browser error/warn logs are empty. Stop both packaged Servers and remove only the generated acceptance subdirectories after verification.

- [ ] **Step 6: Verify the destructive-removal boundary**

Run:

```bash
test ! -e packages/local-runtime
test ! -d packages/desktop/src
rg -n "@localapp/local-runtime|localapp-local-runtime|localapp local install|Commands::Upload" packages pnpm-workspace.yaml README.md init-repo scripts --glob '!**/tests/**'
```

Expected: the first two checks succeed and `rg` returns no production references. Historical specifications/plans and deletion assertions in tests are intentionally outside this production scan.

- [ ] **Step 7: Commit acceptance coverage and final integration fixes**

```bash
git add -A
git commit -m "test: verify unified server distributions end to end"
```

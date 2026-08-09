# Task 2 Report: Unified Server Configuration, Supervision, and Network Rebinding

## Scope completed

- Added canonical `dataDir`-scoped configuration with loopback-by-default listener settings, resolved workspace/key paths, persisted public settings in `server.json`, and environment-variable precedence.
- Added one-time 32-byte JWT instance-key generation at `jwtKeyFile` when `JWT_SECRET` is absent; the key file is mode `0600` on Unix.
- Added `ServerConfigStore` validation/write behavior, including temporary `node:net` listener validation and required LAN acknowledgement.
- Added public system status plus admin system settings/network-rebind routes. The PUT persists settings, replies `202`, and requests restart code `75` only after the response finishes.
- Extended `BuildServerOptions` with injectable `RestartController`.
- Added `localapp-server start` supervisor and worker. The supervisor forwards signals, emits worker readiness JSON, and replaces only workers that exit `75`. A first-run worker issues a setup token and includes `setupUrl` in its ready message.
- Added bounded supervisor-test cleanup using a detached process group and `try`/`finally`, escalating SIGTERM to SIGKILL after two seconds. It covers both already-exited children and all worker descendants.

## RED evidence

1. Initial focused configuration/route RED:

   ```text
   Error: Cannot find module '../src/lib/server-config-store.js'
   expected 404 to be 202
   ```

   Command:

   ```sh
   pnpm -C packages/server exec vitest run tests/config-store.test.ts tests/integration/system-settings.test.ts
   ```

2. Initial supervisor RED:

   ```text
   Error: Supervisor exited before worker readiness (code 1)
   ```

   Command:

   ```sh
   node --test packages/server/tests/supervisor.node-test.mjs
   ```

3. Teardown regression RED after controller observation:

   ```text
   ReferenceError: terminateProcessGroup is not defined
   ```

   The revised test exited in 115ms without leaving a Server process. This established the new cleanup contract before its helper was added.

4. JWT instance-key test mutation RED:

   ```text
   AssertionError: expected '' to match /^[A-Za-z0-9_-]{43}$/
   ```

   Command:

   ```sh
   pnpm -C packages/server exec vitest run tests/config.test.ts
   ```

   The temporary mutation removed key generation; restoring it made all 14 tests pass.

## GREEN evidence

Final focused checks:

```sh
git diff --check
pnpm -C packages/server exec vitest run tests/config-store.test.ts tests/integration/system-settings.test.ts tests/config.test.ts
node --test packages/server/tests/supervisor.node-test.mjs
pnpm -C packages/server build
```

Results:

```text
3 test files passed, 17 tests passed
supervisor.node-test.mjs: 2 passed, 0 failed
@localapp/server build: tsc exit 0
```

Final complete Server suite:

```sh
pnpm -C packages/server test
```

```text
Test Files  123 passed (123)
Tests  815 passed | 1 skipped (816)
Duration  124.81s
```

## Files changed

- `packages/server/src/lib/config.ts`
- `packages/server/src/lib/server-config-store.ts`
- `packages/server/src/routes/system.ts`
- `packages/server/src/server.ts`
- `packages/server/src/worker.ts`
- `packages/server/src/cli.ts`
- `packages/server/src/index.ts`
- `packages/server/package.json`
- `packages/server/tests/config-store.test.ts`
- `packages/server/tests/integration/system-settings.test.ts`
- `packages/server/tests/supervisor.node-test.mjs`
- `packages/server/tests/config.test.ts`
- `packages/server/src/lib/__tests__/app-backups.test.ts`
- `packages/server/src/lib/__tests__/app-data-service.test.ts`
- `packages/server/src/lib/__tests__/content-storage.test.ts`
- `packages/server/src/routes/__tests__/named-sql-first-backend.test.ts`

The existing test fixtures changed only to supply the new required `ServerConfig` fields.

## Self-review

- `server.json` is read only from the selected canonical `dataDir`; no old local, Desktop, or Local Runtime directories are probed or imported.
- The listener defaults to `127.0.0.1`; non-loopback values require `allowInsecureLan: true` and an actual temporary listener bind before write.
- System settings responses are constructed from the public five-field type, so signing keys, storage credentials, and `masterKeyFile` are not serialized.
- CLI flags seed persisted listener settings once, allowing a supervised restart to load the newly saved rebind rather than reapplying stale command-line port values.
- Supervisor test cleanup is bounded and group-scoped; its final process snapshot contains no `cli.js`, `worker.js`, or test process.
- `git diff --check` passed before final verification.

## Concerns

No Task 2 blockers. The full suite emits an existing Fastify `reply.redirect()` deprecation warning (`FSTDEP021`); this change neither introduces nor addresses it.

---

# Task 2 Fix Round 1 Report

## Findings resolved

1. **Transactional network rebind and rollback.** Network settings are now staged in `server.pending.json`, retaining the complete previously persisted five-field configuration. The supervisor starts its replacement with that candidate only; it atomically promotes the candidate to `server.json` after the worker reports readiness. If the candidate exits before readiness (including bind failure), it restores the previous configuration, removes the pending file, and starts the prior listener. The real supervisor test blocks the candidate port and proves the restored listener responds to `/health`.

2. **Loopback-only initial setup.** A zero-user worker always binds `127.0.0.1`, reports a loopback URL, and issues a loopback `setupUrl`; it does not expose the token through `PUBLIC_URL` or a CLI LAN host. Pre-setup CLI host input is persisted as loopback, rather than becoming a later LAN listener automatically. The initialize endpoint also rejects non-loopback request sources before it consumes a token.

3. **Crash-safe settings and key handling.** `server.json` and the pending settings file now use a restrictive unique temporary file, file `fsync`, atomic rename, and directory `fsync` where the platform permits it. JWT key creation uses exclusive creation (`wx`) and repairs an existing Unix key's permissions to `0600`.

4. **Complete accepted loopback range.** Validation and setup-source checks use a shared helper accepting IPv4 `127.0.0.0/8` and IPv6 `::1`; regression coverage includes `127.0.0.2`.

5. **One executable path.** `dist/index.js` now delegates to the same `runCli(["start", ...])` supervisor path as the package executable, while retaining `buildServer` as an import export. A fresh package-main invocation emits supervised setup readiness.

6. **Bounded, exact supervisor tests.** Readiness waits time out after 10 seconds; each spawned supervisor is detached and terminated from `finally` by process group, escalating SIGTERM to SIGKILL after two seconds. Rebind coverage asserts two different worker PIDs and asserts no unexpected third readiness event.

All supervisor and index-entry tests provide `--data-dir` from `mkdtemp` and remove it in `finally`. The accidentally generated repository-root `.localapp-server/` was moved to the system Trash and verified absent before commit; unrelated `.zcode/`, `docs/superpowers/plans/2026-08-09-local-app-install.md`, and `tmp/` were not touched.

## RED evidence

Focused configuration and route tests were added before the implementation:

```sh
pnpm -C packages/server exec vitest run tests/config-store.test.ts tests/integration/system-settings.test.ts tests/integration/setup-flow.test.ts
```

The new expectations failed as intended:

```text
allowInsecureLan must be true when binding outside loopback   # 127.0.0.2 was rejected
expected inode not to be the original inode                  # direct server.json write
expected 403, received 201                                   # remote setup source accepted
expected listenPort 3000, received 43127                     # candidate overwrote canonical config
```

The supervisor RED run:

```sh
node --test packages/server/tests/supervisor.node-test.mjs
```

failed with the new assertions because the worker readiness had no PID, pending configuration was not removed/rolled back on startup failure, and invoking `dist/index.js` did not produce supervised readiness before its bounded timeout.

## GREEN evidence

Amended focused verification:

```sh
git diff --check && pnpm -C packages/server exec vitest run tests/config-store.test.ts tests/integration/system-settings.test.ts tests/integration/setup-flow.test.ts tests/config.test.ts && node --test packages/server/tests/supervisor.node-test.mjs && pnpm -C packages/server build && test ! -e .localapp-server
```

```text
Test Files  4 passed (4)
Tests  22 passed (22)
supervisor.node-test.mjs: 4 passed, 0 failed
@localapp/server build: tsc exit 0
```

Complete Server suite:

```sh
pnpm -C packages/server test
```

```text
Test Files  123 passed (123)
Tests  818 passed | 1 skipped (819)
Duration  131.01s
```

Final hygiene checks confirmed `git diff --check` was clean, repository-root `.localapp-server/` was absent, and there were no surviving relevant `cli.js`, `worker.js`, or supervisor-node-test processes.

## Files changed in Fix Round 1

- `packages/server/src/cli.ts`
- `packages/server/src/index.ts`
- `packages/server/src/lib/config.ts`
- `packages/server/src/lib/loopback.ts`
- `packages/server/src/lib/server-config-store.ts`
- `packages/server/src/routes/setup.ts`
- `packages/server/src/routes/system.ts`
- `packages/server/src/worker.ts`
- `packages/server/tests/config-store.test.ts`
- `packages/server/tests/integration/setup-flow.test.ts`
- `packages/server/tests/integration/system-settings.test.ts`
- `packages/server/tests/supervisor.node-test.mjs`
- `.superpowers/sdd/2026-08-09-unified-server-and-tray/task-2-report.md`

## Fix Round 1 self-review and concerns

- The candidate is never made canonical before its worker reports ready; failed candidates restore the full former persisted settings before the old worker is relaunched.
- The setup bind address and returned setup URL are independently forced to loopback, and the request-origin check makes direct non-loopback initialization fail before token use.
- Atomic writes set permissions at creation and before rename; the platform-specific directory sync deliberately ignores only unsupported directory-sync errors (`EINVAL`, `EPERM`, `EISDIR`).
- The `127.0.0.2` regression is a helper-level assertion because the current test host cannot bind that loopback alias; the helper accepts the full `127/8` range by construction.
- No Task 2 Fix Round 1 blocker remains. The existing Fastify `FSTDEP021` redirect deprecation warning continues to appear in the full suite.

---

# Task 2 Fix Round 2 Report

## Findings resolved

1. **Supervisor crash orphan.** Workers now install a `disconnect` handler before server construction, alongside guarded SIGINT/SIGTERM shutdown. The worker emits a `starting` lifecycle message with its PID before readiness, which the supervisor relays. The live test starts a candidate, SIGKILLs its supervisor while that candidate is pre-ready, proves the candidate PID exits, then starts a fresh supervisor which deterministically promotes the pending candidate and serves health traffic.

2. **JWT first-create race.** JWT creation writes and fsyncs a private `0600` temporary key, publishes it with a no-overwrite hard link, unlinks the temporary path, and directory-syncs where supported. Losing readers require a valid 43-character base64url secret and use a bounded 25 × 10ms retry only when an incomplete key is observed. Concurrent child-process first starts receive one identical valid secret and Unix permissions remain `0600`.

3. **Exact replacement lifecycle observation.** The original rebind test now waits 500ms and counts only readiness events. The hard-death/recovery test asserts the three distinct lifecycle PIDs (original, orphaned candidate, recovered worker) and observes another 500ms stable interval with no extra readiness/replacement.

4. **Environment/pending conflict.** Web rebinding now returns HTTP `409` before validation or staging when any of `LISTEN_HOST`, `LISTEN_PORT`, `PORT`, `PUBLIC_URL`, or `ALLOW_INSECURE_LAN` controls the effective network configuration. The response names the controlling variables, no restart is requested, and no pending file is created. A worker also consumes `LOCALAPP_USE_PENDING_CONFIG` only during its initial load, so a promoted candidate can make later rebind requests normally.

5. **Atomic temporary cleanup.** Atomic settings writes now remove their uniquely named temporary file on write, chmod, fsync, rename, and directory-sync failure paths. Focused injected failures cover write/chmod/fsync/rename and assert that no temporary settings file remains.

6. **Same-port host-only rebind.** Candidate host strings receive non-binding IP-address validation. If only the host changes while a nonzero port remains the same as the current effective configuration, temporary binding is skipped; candidate worker readiness remains the transactional bind/rollback authority. The live supervisor regression performs a loopback → wildcard (new port) → loopback (same port) sequence and reaches `/health` on the final listener.

The Fix Round 1 setup protections remain intact: no-user workers force loopback, token URLs are loopback, direct non-loopback setup initialization is rejected, `127.0.0.0/8` plus `::1` remain accepted, and package main/bin both use the canonical supervisor.

## RED evidence

Initial focused RED tests, before implementation:

```sh
pnpm -C packages/server exec vitest run tests/config-store.test.ts tests/integration/system-settings.test.ts
```

```text
2 failed, 6 passed
promise resolved "undefined" instead of rejecting     # injected settings write was ignored
expected 202 to be 409                                 # LISTEN_PORT-controlled web rebind was staged
```

The controlled incomplete-key reader RED:

```sh
pnpm -C packages/server exec vitest run tests/config-store.test.ts
```

```text
expected '' to be 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
```

The real supervisor lifecycle RED:

```sh
node --test packages/server/tests/supervisor.node-test.mjs
```

```text
Timed out waiting for the candidate worker to start
```

This established that the prior supervisor had no observable pre-ready lifecycle boundary and could not prove hard-death orphan cleanup. During GREEN development, the expanded same-port regression also exposed a real candidate-lifecycle defect:

```text
{"statusCode":500,"error":"Internal Server Error","message":"Pending network configuration is missing"}
```

The cause was a promoted worker retaining `LOCALAPP_USE_PENDING_CONFIG` after the supervisor removed `server.pending.json`; the worker now clears that flag immediately after its initial build.

## GREEN evidence

Focused tests, live supervisor tests, and build:

```sh
pnpm -C packages/server exec vitest run tests/config-store.test.ts tests/integration/system-settings.test.ts tests/integration/setup-flow.test.ts tests/config.test.ts && node --test packages/server/tests/supervisor.node-test.mjs && pnpm -C packages/server build
```

```text
Test Files  4 passed (4)
Tests  29 passed (29)
supervisor.node-test.mjs: 6 passed, 0 failed
@localapp/server build: tsc exit 0
```

After the controller identified overlapping full-suite processes, the duplicate `pnpm -C packages/server test` parents and their Vitest descendants were terminated and verified absent. Exactly one clean isolated full suite was then run and retained through completion:

```sh
pnpm -C packages/server test
```

```text
Test Files  123 passed (123)
Tests  825 passed | 1 skipped (826)
Duration  134.00s
```

Final checks:

```sh
git diff --check
test ! -e .localapp-server
ps -axo pid=,command= | rg '[p]npm -C packages/server test|[v]itest/vitest\\.mjs run|packages/server/dist/(cli|worker)\\.js|supervisor\\.node-test\\.mjs'
```

`git diff --check` passed; the canonical repository-root data directory was absent; the process check found no test, supervisor, or worker descendant.

## Files changed in Fix Round 2

- `packages/server/src/cli.ts`
- `packages/server/src/lib/config.ts`
- `packages/server/src/lib/server-config-store.ts`
- `packages/server/src/routes/system.ts`
- `packages/server/src/worker.ts`
- `packages/server/tests/config-store.test.ts`
- `packages/server/tests/integration/system-settings.test.ts`
- `packages/server/tests/supervisor.node-test.mjs`
- `.superpowers/sdd/2026-08-09-unified-server-and-tray/task-2-report.md`

## Fix Round 2 self-review and concerns

- The IPC disconnect handler is registered before any asynchronous worker initialization and is idempotent with signal/restart shutdown, so a hard parent death cannot retain a pre-ready listener.
- A JWT key is never linked into its public canonical name until content is fully written and file-synced. Readers reject malformed/partial content rather than authenticating with it.
- `server.pending.json` cannot now be finalized through an environment-controlled effective configuration; environment precedence is explicit and observable as a conflict response.
- Temporary-write cleanup runs from one catch path around open/write/chmod/sync/rename/directory-sync, and the injected tests exercise each requested failure point.
- Same-port host-only changes do not rely on whether a specific operating system permits a temporary overlapping bind; the real replacement worker remains the authoritative readiness check with rollback.
- No Task 2 Fix Round 2 blocker remains. The existing Fastify `FSTDEP021` redirect deprecation warning appeared during the full suite and is unrelated to this task.

---

# Task 2 Fix Round 3 Report

## Findings resolved

1. **Post-rename directory-fsync contract.** A successful rename is now treated as the commit point. If the following directory `fsync` fails with an otherwise unsupported error, Server logs a durability warning and continues the already committed transaction rather than reporting a failed staging operation. This rule also applies to the post-commit directory syncs used by finalize/rollback and JWT publication. Pre-rename write/chmod/file-fsync/rename failures still fail and clean the private temporary file.

2. **Portable JWT publication.** The fast path remains private complete-temp → no-overwrite hard link. On filesystems that reject hard links with `EOPNOTSUPP`, `ENOTSUP`, `EPERM`, `EXDEV`, or `EINVAL`, publication uses a bounded exclusive `jwt.key.lock`, checks for an already-published valid key, atomically renames the fully fsynced private temporary key only while it owns the lock, and removes/syncs the lock in `finally`. A stale lock is removed only after 250ms; acquisition/read retries are bounded at 25 × 10ms. Malformed canonical key files still fail closed, per the user ruling.

3. **Route-level transaction consistency.** `BuildServerOptions` now accepts the existing `ServerConfigStore` interface so the normal app config read and `/api/system/settings/network` route share the same injected store. The route-level fault test proves HTTP `202`, restart request, warning, and persisted `server.pending.json` remain aligned after the injected post-rename failure.

## Exact covering test names

Fix Round 3 additions:

- `ServerConfigStore > keeps the pending network configuration staged when directory fsync fails after rename`
- `system settings > continues a web rebind after the pending-file directory fsync fails post-rename`
- `ServerConfigStore > publishes a complete JWT key when hard-link publication is unsupported`
- `ServerConfigStore > gives concurrent readers one complete JWT key when hard links are unsupported`

Previously resolved Task 2 behavior remains covered by these exact tests:

- `ServerConfigStore > recognizes the complete IPv4 loopback range`
- `ServerConfigStore > cleans the private settings temporary file when write fails`
- `ServerConfigStore > cleans the private settings temporary file when chmod fails`
- `ServerConfigStore > cleans the private settings temporary file when fsync fails`
- `ServerConfigStore > cleans the private settings temporary file when rename fails`
- `first-run setup > rejects setup initialization requests that do not originate from loopback`
- `system settings > rejects a web rebind when an environment variable controls network settings`
- `supervisor replaces the worker after a network rebind`
- `supervisor recovers after hard death while a replacement worker is starting`
- `supervisor supports a same-port host-only rebind`
- `supervisor rolls back a pending candidate that fails to bind before readiness`
- `pre-setup CLI LAN options remain contained to loopback and the package main supervises setup`
- `supervisor test cleanup returns when the child has already exited`

## RED evidence

Focused RED before implementation:

```sh
pnpm -C packages/server exec vitest run tests/config-store.test.ts
```

```text
Test Files  1 failed (1)
Tests  3 failed | 10 passed (13)
```

The named failures were:

```text
keeps the pending network configuration staged when directory fsync fails after rename
  promise rejected "injected post-rename directory fsync failure" instead of resolving
publishes a complete JWT key when hard-link publication is unsupported
  Error: hard links unsupported
gives concurrent readers one complete JWT key when hard links are unsupported
  Error: hard links unsupported for test
```

The route-level injected-store RED, before `BuildServerOptions.configStore` was added:

```sh
pnpm -C packages/server exec vitest run tests/integration/system-settings.test.ts
```

```text
system settings > continues a web rebind after the pending-file directory fsync fails post-rename
  expected "warn" to be called with arguments
  Number of calls: 0
```

This showed that the app was not using the fault-injected store, so the test could not establish API/staging alignment until the canonical store was injectable.

## GREEN evidence

Focused store/route tests and build:

```sh
pnpm -C packages/server exec vitest run tests/config-store.test.ts tests/integration/system-settings.test.ts && pnpm -C packages/server build
```

```text
Test Files  2 passed (2)
Tests  16 passed (16)
@localapp/server build: tsc exit 0
```

Amended focused tests and the complete six-test supervisor suite:

```sh
pnpm -C packages/server exec vitest run tests/config-store.test.ts tests/integration/system-settings.test.ts tests/integration/setup-flow.test.ts tests/config.test.ts && node --test packages/server/tests/supervisor.node-test.mjs
```

```text
Test Files  4 passed (4)
Tests  33 passed (33)
supervisor.node-test.mjs: 6 passed, 0 failed
```

Exactly one isolated full Server suite was started only after process hygiene confirmed no competing suite, supervisor, or worker:

```sh
pnpm -C packages/server test
```

```text
Test Files  123 passed (123)
Tests  829 passed | 1 skipped (830)
Duration  127.34s
```

Final hygiene checks passed:

```sh
git diff --check
test ! -e .localapp-server
ps -axo pid=,command= | rg '[p]npm -C packages/server test|[v]itest/vitest\\.mjs run|packages/server/dist/(cli|worker)\\.js|supervisor\\.node-test\\.mjs'
```

No matching process or root `.localapp-server/` directory remained.

## Files changed in Fix Round 3

- `packages/server/src/lib/config.ts`
- `packages/server/src/lib/server-config-store.ts`
- `packages/server/src/server.ts`
- `packages/server/tests/config-store.test.ts`
- `packages/server/tests/integration/system-settings.test.ts`
- `packages/server/tests/fixtures/no-hard-link.cjs`
- `.superpowers/sdd/2026-08-09-unified-server-and-tray/task-2-report.md`

## Fix Round 3 self-review and concerns

- A write is no longer reported as failed after its canonical filename has been committed solely because a directory durability flush failed. The warning records that the committed state may not yet be crash-durable on that filesystem.
- The fallback key protocol never renames a private temporary key until it holds the exclusive bounded lock, and every loser, error path, and winner lock cleanup removes its private temp/lock path in `finally` or the caller cleanup path.
- Concurrent hard-link-disabled child processes all observe a single valid 43-character key; the tests also assert no temporary key or lock remains.
- Existing malformed generated key files remain fail-closed; this deliberately follows the user ruling and does not add legacy content compatibility.
- No Task 2 Fix Round 3 blocker remains. The existing Fastify `FSTDEP021` warning still appears during the full suite.

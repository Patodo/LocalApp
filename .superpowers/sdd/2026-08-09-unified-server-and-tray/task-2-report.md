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

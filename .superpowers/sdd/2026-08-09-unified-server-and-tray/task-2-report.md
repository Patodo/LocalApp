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

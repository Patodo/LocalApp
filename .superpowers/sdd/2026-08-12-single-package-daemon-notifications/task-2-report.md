# Task 2 Report: TypeScript profiles and authentication

## Scope and implementation

Implemented only Task 2 of the single-package daemon plan. The TypeScript CLI now:

- stores a versioned `profiles.json` document with `version: 1`, an explicit
  `currentProfile`, and named `ServerProfile` entries;
- uses `LOCALAPP_CONFIG_DIR` as the deterministic override and otherwise uses
  the platform user config root;
- normalizes profile servers to credential-free HTTP(S) origins and rejects
  paths, queries, fragments, and URL credentials;
- publishes profile updates through a same-directory unique temporary file,
  file `fsync`, rename, POSIX `0600`, and directory `fsync`;
- sends authenticated JSON and package-upload requests with `X-API-Key`,
  `X-CLI-Version: 0.1.0`, `redirect: "manual"`, a 30-second default timeout,
  and the login-specific 10-second timeout;
- dispatches noninteractive `login`, `logout`, and `whoami` through
  `runLocalApp(argv, io)`;
- validates login with `/api/me` before persistence, removes only the selected
  profile credential on logout, and prints the authenticated `/api/me`
  envelope for whoami; and
- never writes the supplied API key to CLI stdout, stderr, or error payloads.
  `whoami` also removes any unexpected `apiKey`, `api_key`, or `api-key` field
  from a Server response before writing its envelope.

No Task 3+ command behavior was added.

## Files changed

- Created `packages/localapp/src/config/paths.ts`
- Created `packages/localapp/src/config/profile-store.ts`
- Created `packages/localapp/src/http/localapp-client.ts`
- Created `packages/localapp/src/commands/login.ts`
- Created `packages/localapp/src/commands/logout.ts`
- Created `packages/localapp/src/commands/whoami.ts`
- Created `packages/localapp/src/commands/shared.ts`
- Created `packages/localapp/tests/profile-store.test.ts`
- Created `packages/localapp/tests/localapp-client.test.ts`
- Created `packages/localapp/tests/login.test.ts`
- Modified `packages/localapp/src/main.ts`
- Modified `packages/localapp/vitest.config.ts` so the required `tests/`
  integration tests are included by `pnpm test`.

## TDD evidence

### Initial RED

Command:

```sh
pnpm -C packages/localapp exec vitest run tests/profile-store.test.ts tests/localapp-client.test.ts tests/login.test.ts
```

Output:

```text
Test Files  3 failed (3)
Tests  no tests
Cannot find module '../src/config/profile-store.js'
Cannot find module '../src/http/localapp-client.js'
```

This was the expected RED: none of the Task 2 production modules existed.

### Security-hardening RED

Command:

```sh
pnpm -C packages/localapp exec vitest run tests/login.test.ts
```

Output before redaction:

```text
Test Files  1 failed (1)
Tests  1 failed | 3 passed (4)
AssertionError: expected true to be false
```

The failing regression demonstrated that an unexpected API-key field from a
whoami response was forwarded to stdout. The production change redacts such
fields before serialization.

### GREEN

Commands and observed output:

```text
pnpm -C packages/localapp exec vitest run tests/profile-store.test.ts tests/localapp-client.test.ts tests/login.test.ts
Test Files  3 passed (3)
Tests  8 passed (8)

pnpm -C packages/localapp exec vitest run tests/login.test.ts
Test Files  1 passed (1)
Tests  4 passed (4)

pnpm -C packages/localapp build
tsc -p tsconfig.json (exit 0)

pnpm -C packages/localapp test
Test Files  4 passed (4)
Tests  55 passed (55)

pnpm -C packages/server exec vitest run tests/integration/auth.test.ts tests/integration/global-auth.test.ts
Test Files  2 passed (2)
Tests  9 passed (9)
```

## Test evidence

The new tests use actual temporary profile directories under this repository's
`tmp/localapp-task-2-tests/` and real Node HTTP servers. They verify the final
profile mode and document, URL rejection, cross-origin redirect non-following,
authentication and CLI-version headers, login-before-save, rejected-login
non-persistence, selected-profile logout isolation, whoami envelope output,
and API-key redaction. Existing argument-parser tests remained green.

## Self-review

- `git diff --check` completed without whitespace errors.
- Every authenticated fetch sets `redirect: "manual"`; redirect failures omit
  the redirect target and request headers from their error result.
- Command error paths use fixed structured messages rather than caught error
  text, preventing request credentials from being rendered.
- The profile temporary file is created next to the destination at `0600`,
  fsynced before rename, and directory-fsynced after publication on POSIX.
- The changes are restricted to the Task 2 CLI, its tests, and this report;
  unrelated untracked files were left untouched.

## Concerns

No outstanding concerns. Interactive login was intentionally not preserved:
the parser-supported noninteractive Server URL and `--api-key` form is
mandatory and avoids any secret prompt handling in this task.

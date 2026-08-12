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

## Fix round: review findings

This fix round addressed the Critical and three Important findings from the
Task 2 review. The Minor logout-report finding was deliberately not changed.

### Implementation

- Command JSON serialization now redacts the exact selected credential after
  serialization. This protects `login` against a credential reflected in
  `id`, `name`, or `role`, and protects `whoami` regardless of field name or
  nesting. Fixed command errors remain fixed strings and never serialize a
  response body.
- Existing `profiles.json` reads first reject symlinks, then use a POSIX
  `O_NOFOLLOW` descriptor and validate the opened descriptor. POSIX reads
  require a regular file owned by the current UID with mode exactly `0600`
  before parsing any credentials. Windows keeps regular-file/symlink checks
  without claiming that POSIX UID/mode metadata proves DACL safety.
- `loadPackageVersion()` now reads the package-local manifest. Source code
  resolves `packages/localapp/package.json`; the self-contained bundle resolves
  the packed artifact's adjacent `package.json`. Both `--version` and the
  authenticated `X-CLI-Version` header use it.
- `LocalAppClient` has a narrow injectable timer boundary for deterministic
  timeout tests. `login` has a narrow client-construction seam, letting its
  10-second contract be observed using the real client and real local HTTP
  server. No production timeout values changed.

### Covering test files

- `packages/localapp/tests/login.test.ts`: reflected credentials in login
  identity fields and nested whoami fields; literal 10,000 ms login timeout.
- `packages/localapp/tests/profile-store.test.ts`: unsafe existing mode,
  symlink rejection, and an actual foreign-UID rejection when the test runs
  with privilege.
- `packages/localapp/tests/version.test.ts`: manifest loading plus shared
  `--version` and authenticated-header manifest version.
- `packages/localapp/tests/localapp-client.test.ts`: real HTTP JSON POST,
  multipart package upload, authentication/version headers, and literal
  30,000 ms ordinary timeout.

### RED evidence

```text
pnpm -C packages/localapp exec vitest run tests/login.test.ts
Test Files  1 failed (1)
Tests  2 failed | 4 passed (6)
AssertionError: expected true to be false

pnpm -C packages/localapp exec vitest run tests/profile-store.test.ts
Test Files  1 failed (1)
Tests  2 failed | 2 passed | 1 skipped (5)
Profile document loaded instead of rejecting unsafe mode and symlink paths.

pnpm -C packages/localapp exec vitest run tests/version.test.ts
Test Files  1 failed (1)
Cannot find module '../src/version.js'

pnpm -C packages/localapp exec vitest run tests/localapp-client.test.ts tests/login.test.ts
Test Files  2 failed (2)
Tests  2 failed | 10 passed (12)
expected [] to deeply equal [ 30000 ]
expected [] to deeply equal [ 10000 ]
```

The POST and multipart tests passed before the timer seam existed; they were
added as real-Server coverage for already-correct behavior, while the same RED
run proved the previously unobservable timeout contracts were uncovered.

### GREEN evidence

```text
pnpm -C packages/localapp exec vitest run tests/login.test.ts
Test Files  1 passed (1)
Tests  6 passed (6)

pnpm -C packages/localapp exec vitest run tests/profile-store.test.ts
Test Files  1 passed (1)
Tests  4 passed | 1 skipped (5)

pnpm -C packages/localapp exec vitest run tests/version.test.ts
Test Files  1 passed (1)
Tests  2 passed (2)

pnpm -C packages/localapp exec vitest run tests/localapp-client.test.ts tests/login.test.ts
Test Files  2 passed (2)
Tests  12 passed (12)

pnpm -C packages/localapp test
Test Files  5 passed (5)
Tests  65 passed | 1 skipped (66)

pnpm -C packages/localapp build
tsc -p tsconfig.json (exit 0)

pnpm -C packages/server exec vitest run tests/integration/auth.test.ts tests/integration/global-auth.test.ts
Test Files  2 passed (2)
Tests  9 passed (9)

LOCALAPP_PACKAGE_DIR=<repo>/tmp/localapp-task-2-package pnpm -C packages/localapp build:package
node <repo>/tmp/localapp-task-2-package/bin/localapp.mjs --version
localapp 0.1.0
```

### Fix-round review and concern

- `git diff --check` passed.
- No source version literal remains outside `packages/localapp/package.json`.
- The foreign-UID regression is a real filesystem test but is skipped for a
  non-root developer process because POSIX correctly forbids manufacturing a
  differently-owned file without privilege; the production UID check is active
  on every POSIX run.
- The temporary packed artifact was created only under the repository's
  `tmp/localapp-task-2-package/` for the self-contained runtime check.

## Fix round 2: escaped credential serialization

### Implementation

Fixed the remaining Critical output-leak finding in
`packages/localapp/src/commands/shared.ts`. `writeCredentialSafeJson` now
recursively creates a sanitized copy before serialization: every string value
and every object key replaces the exact credential with `[REDACTED]`; arrays
and nested objects are traversed. It does not mutate the supplied response
object. The resulting value is then serialized once with `JSON.stringify`, so
the output remains valid JSON and cannot retain the credential only in escaped
JSON form.

### Covering tests

`packages/localapp/tests/login.test.ts` now covers:

- a real local `/api/me` login response reflecting a quote/backslash
  credential in the user identity;
- a real local `/api/me` whoami response reflecting that credential in a
  nested array value and an object key; and
- the newline-containing credential serialization boundary directly, because
  Fetch correctly rejects newline characters in HTTP header values before a
  request can reach any Server. This test uses the same production writer and
  proves nested key/value redaction, raw and escaped-form absence, parseable
  JSON, and lack of mutation.

### RED

```text
pnpm -C packages/localapp exec vitest run tests/login.test.ts
Test Files  1 failed (1)
Tests  3 failed | 7 passed (10)

redacts a quote and backslash credential reflected by login before JSON serialization
redacts an escaped quote and backslash credential from nested whoami values and object keys before serialization
sanitizes a newline credential in nested object keys and array values before serialization without mutation

AssertionError: expected serialized output not to contain the credential's
JSON-escaped representation
```

The first attempt with a newline credential through the real HTTP command
correctly failed at Fetch header validation, not at the serializer. The final
RED uses quote/backslash through the real server and newline at the narrow
serialization boundary, where it can be represented and verified safely.

### GREEN

```text
pnpm -C packages/localapp exec vitest run tests/login.test.ts
Test Files  1 passed (1)
Tests  10 passed (10)

pnpm -C packages/localapp build
tsc -p tsconfig.json (exit 0)

pnpm -C packages/localapp test
Test Files  5 passed (5)
Tests  68 passed | 1 skipped (69)

pnpm -C packages/server exec vitest run tests/integration/auth.test.ts tests/integration/global-auth.test.ts
Test Files  2 passed (2)
Tests  9 passed (9)
```

`git diff --check` also completed without errors.

## Fix round 3: marker-overlap credential redaction

### Implementation

Fixed the remaining marker-overlap Critical edge in
`packages/localapp/src/commands/shared.ts`. Redaction remains recursive and
pre-serialization. For every non-empty credential, the deterministic marker is
`[REDACTED]` only when that marker does not contain the credential. Otherwise,
the marker is the private-use scalar `\uE000`; the sole one-character collision
with that scalar deterministically uses `\uE001`. A marker therefore never
contains the credential it replaces. Both string values and object keys use the
same marker; the input is still copied rather than mutated.

### Covering tests

`packages/localapp/tests/login.test.ts` adds literal direct serialization
regressions for credentials `D` and `[REDACTED]`. In each case the credential
appears in both a nested object key and nested array value. The tests assert the
raw and JSON-escaped credential are absent, the parsed key/value are literally
the selected `\uE000` marker, and the original input remains unchanged.

### RED

```text
pnpm -C packages/localapp exec vitest run tests/login.test.ts
Test Files  1 failed (1)
Tests  2 failed | 10 passed (12)

uses a marker without a single-character credential in nested keys and values
uses a marker without the literal [REDACTED] credential in nested keys and values

AssertionError: serialized output unexpectedly contained D / [REDACTED]
```

### GREEN

```text
pnpm -C packages/localapp exec vitest run tests/login.test.ts
Test Files  1 passed (1)
Tests  12 passed (12)

pnpm -C packages/localapp build
tsc -p tsconfig.json (exit 0)

pnpm -C packages/localapp test
Test Files  5 passed (5)
Tests  70 passed | 1 skipped (71)

pnpm -C packages/server exec vitest run tests/integration/auth.test.ts tests/integration/global-auth.test.ts
Test Files  2 passed (2)
Tests  9 passed (9)
```

`git diff --check` completed without errors. The deferred logout-report minor
was not changed.

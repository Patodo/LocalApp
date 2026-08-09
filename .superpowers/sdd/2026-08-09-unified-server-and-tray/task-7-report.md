# Task 7 implementation report

## RED evidence

Tests were written before Task 7 production code.

### Server RED

Command:

```text
pnpm -C packages/server exec vitest run tests/integration/two-peer-sync.test.ts
```

Observed exit code: `1`.

Observed summary:

```text
Test Files  1 failed (1)
Tests       no tests
Duration    576ms
```

The suite failed during import for the expected missing Task 7 module:

```text
Error: Cannot find module '../../src/lib/sync-job-store.js'
packages/server/tests/integration/two-peer-sync.test.ts:8:1
```

### Web RED

The first Web run exposed one fixture mistake in an existing peer-creation test because the new default mock returned a duplicate peer. The test fixture was corrected before production implementation and the focused RED command was rerun:

```text
pnpm -C packages/web exec vitest run components/peers/peers-page.test.tsx
```

Observed exit code: `1`.

Observed summary:

```text
Test Files  1 failed (1)
Tests       2 failed | 2 passed (4)
Duration    2.74s
```

Both failures were the expected missing Task 7 UI behavior:

```text
Unable to find a label with the text of: 同步应用 office
```

The two pre-existing peer credential tests passed in the corrected RED run.

### Exact package-retention RED

After the package-source dependency was explicitly resolved, a focused regression was added before changing Task 3 installation:

```text
pnpm -C packages/server exec vitest run tests/integration/app-package-install.test.ts -t 'atomically retains the exact inspected package'
```

Observed exit code: `1`.

Observed summary:

```text
Test Files  1 failed (1)
Tests       1 failed | 22 skipped (23)
```

The expected missing metadata reference was observed:

```text
TypeError: .toMatch() expects to receive a string, but got undefined
packages/server/tests/integration/app-package-install.test.ts:369
```

### Reflected-credential RED

A malicious-peer regression was then added before hardening source error handling. The fake peer reflected the Bearer header in its error response.

```text
pnpm -C packages/server exec vitest run tests/integration/two-peer-sync.test.ts -t 'does not persist a malicious peer response'
```

Observed exit code: `1`; `1 failed | 6 skipped`. The failure showed the exact target API Key persisted in both the source job history and error field. After replacing untrusted peer error text/codes with a local allowlisted code and generic status message, the same command passed (`1 passed | 6 skipped`).

### Web state-history RED found during self-review

The final brief audit found that the job card exposed the current status but not its persisted transition history. A focused assertion was added before the UI correction:

```text
pnpm -C packages/web exec vitest run components/peers/peers-page.test.tsx
```

Observed exit code: `1`.

```text
Test Files  1 failed (1)
Tests       1 failed | 3 passed (4)
Duration    878ms
```

The expected missing history entry was observed:

```text
TestingLibraryElementError: Unable to find an element with the text: queued.
components/peers/peers-page.test.tsx:93
```

## GREEN evidence

### Focused Server

```text
pnpm -C packages/server exec vitest run tests/integration/two-peer-sync.test.ts tests/integration/app-package-install.test.ts tests/integration/peers.test.ts tests/integration/security-boundary.test.ts
```

Exit code: `0`.

```text
Test Files  4 passed (4)
Tests       48 passed (48)
Duration    9.10s
```

This includes a second independently initialized Server worker with its own data directory and port. The peer push preserved the target database row and upload, retained byte-identical package content, and remained idempotent.

### Focused Web

```text
pnpm -C packages/web exec vitest run components/peers/peers-page.test.tsx
```

Exit code: `0`.

```text
Test Files  1 passed (1)
Tests       4 passed (4)
Duration    937ms
```

The focused test verifies app-only payloads, credential absence, persisted history rendering, HTML-shaped history content rendered only as text, stable EventSource identity, cancellation, and terminal/unmount cleanup.

### Full Server and build

```text
pnpm -C packages/server test
```

Exit code: `0`.

```text
Test Files  135 passed (135)
Tests       921 passed | 1 skipped (922)
Duration    154.61s
```

`pnpm -C packages/server build` also exited `0`.

### Full Web and build

```text
pnpm -C packages/web test && pnpm -C packages/web build
```

Exit code: `0`.

```text
Test Files  45 passed (45)
Tests       372 passed (372)
Duration    21.44s
Static pages 27/27
```

The build emitted only the repository's existing Next.js static-export rewrite warnings.

### Final hygiene

- `git diff --check`: passed.
- Built Server/Web output scan for known peer credential fixtures: no matches.
- Production source scan for `withData: true`: no matches.
- Runtime tests inspect persisted source jobs and target session JSON for credential leakage.

## Self-review

- Owner scoping is enforced on source jobs and every target session operation; cross-owner target access is non-disclosing.
- Uploads stream to unique partial files with declared/actual limits, incremental SHA-256, file fsync, atomic rename, and directory fsync.
- Exact inspected portable packages are retained atomically by the shared Task 3 installer for browser, CLI/API-key, and peer installs. Sync never reconstructs a lossy package.
- Target installation delegates to Task 3 and preserves target business rows, uploads, and access rules; migration failure restores the prior version/database.
- Source jobs persist in Server metadata, target sessions persist under Server-owned staging, and both reconcile interrupted startup states.
- Idempotency, digest conflicts, cancellation boundaries, abandoned-session pruning, malicious reflected responses, traversal attempts, and credential non-leakage have focused regression coverage.
- Web history values use React text nodes (no raw HTML), while SSE connections remain stable by job ID and close on terminal/removal/unmount.
- Task 8/application-plus-data behavior was not implemented. No unresolved Critical or Important defect was found in the final diff review.
- Changed scope is 14 files: 10 production files, 3 test files, and this report. `.zcode/`, `tmp/`, and `docs/superpowers/plans/2026-08-09-local-app-install.md` remain untouched and untracked.

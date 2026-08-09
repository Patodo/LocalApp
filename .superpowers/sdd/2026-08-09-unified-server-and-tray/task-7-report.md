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

---

# Task 7 review fix round 1/5

## RED evidence

### Task 3 interrupted installer recovery

```text
pnpm -C packages/server exec vitest run tests/integration/app-installer-recovery.test.ts
```

Exit code: `1`.

```text
Test Files  1 failed (1)
Tests       2 failed (2)
Duration    2.39s
```

The first real child process exited after the v2 migration was written but before activation. A fresh `buildServer()` retained the v1 metadata while the database still contained the v2 `upgraded` column:

```text
expected [ 'id', 'value', 'upgraded' ] to not include 'upgraded'
app-installer-recovery.test.ts:32
```

The second child exited immediately after the new metadata rename. The expected durable Task 3 installer journal did not exist:

```text
expected false to be true
app-installer-recovery.test.ts:46
```

### Session publication and meta.sqlite durability

```text
pnpm -C packages/server exec vitest run tests/meta-sqlite-durability.test.ts tests/integration/two-peer-sync.test.ts
```

Exit code: `1`.

```text
Test Files  2 failed (2)
Tests       7 failed | 8 passed (15)
Duration    3.40s
```

Observed failures matched the missing guarantees:

- injected session metadata publication left the final session directory visible (`expected true to be false`);
- pruning removed only the valid expired session instead of three expired valid/orphan/corrupt uncommitted residues (`expected 1 to be 3`);
- injected meta rename and real directory-fsync failures did not throw;
- unsupported directory-fsync tests observed zero fsync calls instead of the required file + directory pair.

### Target commit serialization and source deadlines/cancellation

```text
pnpm -C packages/server exec vitest run tests/app-sync-hardening.test.ts
```

Exit code: `1`.

```text
Test Files  1 failed (1)
Tests       4 failed (4)
Errors      2 errors
Duration    1.28s
```

The four focused failures were exact evidence of the review findings:

- the injected target installer was never called (`expected 0 to be 1`), so two concurrent commits were not serialized through one install operation;
- a never-resolving upload remained permanently `installing` beyond its configured hard deadline;
- response loss on the first target commit left the source `failed` instead of retrying to the persisted `completed` outcome;
- cancellation in `activating` was rejected locally and never consulted the target (`deleteCalls expected 1, received 0`).

The two unhandled rejections came from the deliberately failing target-concurrency test exiting before its deferred real installer promises settled. The test cleanup is corrected before the GREEN run; it does not alter the four product RED observations above.

### Transactional meta publication error preservation

```text
pnpm -C packages/server exec vitest run tests/meta-sqlite-durability.test.ts -t 'does not mask'
```

Exit code: `1`.

```text
Test Files  1 failed (1)
Tests       1 failed | 5 skipped (6)
Duration    225ms
```

After an injected atomic-rename `EIO`, the transactional caller attempted `ROLLBACK` on the SQL.js image that publication recovery had already closed. The assertion expected `transaction publication failed` but received `Database closed`, proving the real durability failure was masked.

## GREEN evidence

### Final Task 7 focused Server group

```text
pnpm -C packages/server exec vitest run tests/meta-sqlite-durability.test.ts tests/app-sync-hardening.test.ts tests/integration/app-installer-recovery.test.ts tests/integration/two-peer-sync.test.ts tests/integration/app-package-install.test.ts tests/integration/peers.test.ts tests/integration/security-boundary.test.ts
```

Exit code: `0`.

```text
Test Files  7 passed (7)
Tests       66 passed (66)
Duration    13.88s
```

This covers real child-process installer crashes, fail-closed unrecoverable startup, atomic session publication/residue pruning, atomic meta publication and reentrancy, target commit serialization/retries, upload and commit hard deadlines, both cancellation outcomes at the activation boundary, owner scoping, credential non-leakage, and the original Task 7 install/peer/security cases.

### Full Server and build

Final full run:

```text
pnpm -C packages/server test
```

Exit code: `0`.

```text
Test Files  138 passed (138)
Tests       939 passed | 1 skipped (940)
Duration    164.94s
```

`pnpm -C packages/server build` exited `0` with no TypeScript errors.

An immediately preceding full run had one unrelated `workspace-clone.test.ts` two-second Git clone timeout (`137 passed`, one failed). Its isolated rerun passed `5/5` in `1.21s`, and the subsequent final full run above passed all 138 files. The only emitted Server warning was the repository's existing Fastify `reply.redirect` deprecation warning.

### Full Web and build

```text
pnpm -C packages/web test
```

Exit code: `0`.

```text
Test Files  45 passed (45)
Tests       372 passed (372)
Duration    18.02s
```

`pnpm -C packages/web build` exited `0`, compiled successfully, and generated `27/27` static pages. It emitted only the repository's existing Next.js static-export rewrite warnings. No Web production file changed in this review round.

## Round 1 self-review

- Task 3 now writes a durable installer transaction before database mutation, including the exact backup identity/digest and prior/new application identity. Startup reconciliation runs before routes: it repeats a marked rollback, verifies and completes an activated install, or persists/reports `recovery-required` and refuses startup when safety cannot be proven.
- Session creation writes and fsyncs complete metadata in a private staged directory before atomic publication. Idempotent retry recovers safe empty/corrupt uncommitted residue, metadata conflicts remain non-destructive, and pruning preserves committing/completed/recovery-required sessions and any residue containing a package.
- Every shared meta.sqlite save publishes a full private temp image using file fsync, atomic rename, and parent-directory fsync. Unsupported directory-fsync codes (`EINVAL`, `EPERM`, `EISDIR`) accept the successfully renamed state; real I/O failures throw and reload the visible disk image. Reentrant mutation is rejected, and committed SQL transactions no longer mask publication failures with an invalid rollback.
- Target commits are serialized by session, duplicate callers await one installer invocation, completed outcomes are replayed after response loss, and startup reconciliation verifies the retained exact package, active version directory, and complete migration history rather than trusting metadata alone.
- Source upload and commit requests combine manual cancellation with hard deadlines. Commit response loss/in-progress replies retry until the persisted target outcome is known; deadline expiry becomes `recovery-required`. Cancellation is decided by the target at the installing/activating boundary, using the active job's ephemeral exact peer credential; a 409 leaves the commit running, while 204 aborts locally. APP errors are `failed`, never falsely reported as rolled back.
- API keys remain encrypted only in the peer store and ephemeral in active request state; jobs, sessions, public errors, and report output contain no credential. No production `withData: true` path exists, so Task 8 was not implemented.
- Final changed scope is 12 task files: 6 production files, 5 test files, and this report. `.zcode/`, `tmp/`, and `docs/superpowers/plans/2026-08-09-local-app-install.md` remain untouched and untracked.
- No unresolved Critical or Important finding remains. The only concern observed during final verification was the transient unrelated Git clone timeout documented above; both isolated and final full-suite reruns passed.

---

# Task 7 review fix round 2/5

## RED evidence

### App-state durability, session adoption, and target recovery mapping

```text
pnpm -C packages/server exec vitest run tests/app-manifest-durability.test.ts tests/app-sync-hardening.test.ts
```

Exit code: `1`.

```text
Test Files  2 failed (2)
Tests       6 failed | 6 passed (12)
Duration    1.47s
```

The six failures directly reproduced three review findings:

- no temporary app-state file or parent directory fsync was observed, and an injected post-meta directory-fsync failure did not throw or retain the recovery journal;
- incomplete existing session metadata was adopted, while existing-ID and rename-race adoption returned without attempting the required root-directory fsync;
- a trusted `APP_INSTALL_RECOVERY_REQUIRED` target response persisted the source job as `failed` instead of `recovery-required` (the stored message was already generic and credential-free).

### Exact installer journal identity and symlink rejection

```text
pnpm -C packages/server exec vitest run tests/integration/app-installer-recovery.test.ts -t 'malicious|wrong exact basename|replaced by a symlink'
```

Exit code: `1`.

```text
Test Files  1 failed (1)
Tests       4 failed | 4 skipped (8)
Duration    3.40s
```

All four malicious journals allowed Server startup instead of failing closed. The current recovery accepted an upload directory as `versionPath`, another retained package as `packagePath`, a wrong backup basename, and a symlink at the nominal backup path. The tests preserve sentinel upload/package/backup data and fail explicitly with `Server unexpectedly started with an unsafe installer journal`.

A follow-up dangling-link mutation check also produced valid RED:

```text
pnpm -C packages/server exec vitest run tests/integration/app-installer-recovery.test.ts -t 'dangling symlink'
```

Exit code: `1`; one test failed because Server unexpectedly started after the exact retained package path was replaced by a dangling symlink.

### Installer-journal removal ordering

The full installer recovery focused run also failed the syscall-order assertion:

```text
expected durableBeforeInstallerJournalRemoval to be true, received false
app-installer-recovery.test.ts:112
```

This proves the durable installer journal was removed before a parent-directory fsync made the new `meta.json` rename durable.

## GREEN evidence

### New focused durability/security tests

```text
pnpm -C packages/server exec vitest run tests/app-manifest-durability.test.ts tests/integration/app-installer-recovery.test.ts tests/app-sync-hardening.test.ts
```

Exit code: `0`.

```text
Test Files  3 passed (3)
Tests       21 passed (21)
Duration    5.63s
```

### Task 7 seven-file group

```text
pnpm -C packages/server exec vitest run tests/meta-sqlite-durability.test.ts tests/app-sync-hardening.test.ts tests/integration/app-installer-recovery.test.ts tests/integration/two-peer-sync.test.ts tests/integration/app-package-install.test.ts tests/integration/peers.test.ts tests/integration/security-boundary.test.ts
```

Exit code: `0`.

```text
Test Files  7 passed (7)
Tests       76 passed (76)
Duration    17.84s
```

The first seven-file attempt exposed two existing app-manifest contract regressions: pre-rename metadata failure did not immediately restore the old source manifest, and app-state journal cleanup failure incorrectly made an otherwise durable install return 503. After separating pre-rename rollback, post-rename durability uncertainty, and idempotent cleanup failure, the two existing tests passed and the final seven-file run above was clean.

### Full Server and build

```text
pnpm -C packages/server test
```

Exit code: `0`.

```text
Test Files  139 passed (139)
Tests       951 passed | 1 skipped (952)
Duration    171.07s
```

`pnpm -C packages/server build` exited `0` with no TypeScript errors. The only Server warning was the repository's existing Fastify `reply.redirect` deprecation warning.

No Web/shared response shape changed in round 2, so the round 1 full Web evidence (`45/45` files, `372/372` tests, successful 27-page build) stands as authorized by the review instruction.

## Round 2 self-review

- Shared app-state publication now fsyncs every private temporary file, atomically renames it, and fsyncs its parent directory. The durable intent journal precedes source/meta publication; installer journal removal only occurs after both are durably visible.
- Publication errors are split by commit point: failures before rename durably publish and apply a rollback intent; failures after rename but before directory fsync preserve the recovery journal; cleanup failure after durable source/meta commit is tolerated because replay is idempotent. Existing activation/rollback atomicity contracts remain green.
- Installer recovery validates exact owner/app/job identity, UUID, version number/digest, `versions/vN`, `.packages/vN-<digest>.localapp`, and `.staging/apps/<id>/app.db.before-install`. Every existing path component is checked with `lstat`, including dangling symlinks, before recovery can write or delete.
- Malicious journal tests prove upload directories, unrelated retained packages, alternate backups, valid-target symlinks, and dangling package symlinks are not adopted or removed; Server fails closed before serving.
- Existing-ID and rename-race session adoption now validate the complete persisted record and fsync the session root before returning. Real fsync errors propagate exactly once; semantic corruption is retained/fails closed while empty or syntactically partial crash residue remains recoverable.
- `APP_INSTALL_RECOVERY_REQUIRED` is trusted only as a protocol code and maps explicitly to persisted source `recovery-required`. Peer body text is ignored; the stored message stays `Peer synchronization failed (503)` and does not contain the bearer credential.
- No production `withData: true` path or Task 8 behavior was introduced. No Web production file or API shape changed.
- Round 2 scope is 8 files: 4 production files, 3 test files, and this report. Preserved untracked `.zcode/`, `tmp/`, and `docs/superpowers/plans/2026-08-09-local-app-install.md` remain untouched.
- No unresolved Critical or Important defect was found in the final diff review.

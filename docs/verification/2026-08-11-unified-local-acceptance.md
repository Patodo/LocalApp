# Unified local acceptance — 2026-08-11

## Scope

This record covers the one-Server model, the two builtin-template applications, the generic Device Action executor, and the local Browser acceptance completed during Task 16. Generated projects, Server data, CLI profiles, uploaded/downloaded acceptance files, packages, and other transient output remain below repository-owned `tmp/` directories; deterministic source fixtures remain with their example applications.

Task 16 implementation, Browser verification within the allowed Scheme boundary, active-spec reconciliation, the full regression matrix, and two independent final rereviews are complete. Both reviewers returned clean after their findings were repaired; this record accompanies the canonical runtime integration commit.

## Packaged Server and real CLI installation

A packaged Server was started at `http://127.0.0.1:3000` with repository-local data and initialized with owner `acceptance-owner`.

The CLI profile was isolated from the user's normal configuration by setting `LOCALAPP_CONFIG_DIR` to a directory below the repository `tmp/` tree. Using profile `formal-local`, the real CLI command `localapp app install --target formal-local` built and installed both applications into the packaged Server:

- `http://127.0.0.1:3000/acceptance-owner/skill-market/`
- `http://127.0.0.1:3000/acceptance-owner/resume-manager/`

These formal `/<owner>/<app>/` routes, rather than raw `/serve/<owner>/<app>/` resource routes, were used for Browser acceptance.

A second acceptance run started from an empty directory below `tmp/unified-acceptance`. The real command `localapp init --name fresh-local-app --builtin-repo` extracted the builtin template, installed dependencies, ran the template tests and build, created the application package, and installed it into the same packaged Server. This initially exposed the parent-pnpm-workspace bug described below; after the fix, the complete command succeeded and created `acceptance-owner/fresh-local-app`.

## Automated evidence

The independent `pnpm test:real-apps` run passed all 3 tests. It exercised the complete generic Device Action installation path and verified that the requested SKILL was installed at:

`tmp/unified-acceptance/installed-skills/localapp-device-actions/SKILL.md`

The deterministic real-app suite also verifies formal package installation, resume image/PDF upload and byte-for-byte download, owner filtering, deletion, and Device Action execution.

The final post-repair regression matrix passed:

- `cargo test --manifest-path packages/cli/Cargo.toml` — 176 tests across all CLI suites.
- `cargo test --manifest-path packages/localapp-core/Cargo.toml` — 30 tests.
- `cargo test --manifest-path packages/localapp-template/Cargo.toml` — 19 tests.
- `pnpm -C init-repo test` — 23 files, 356 tests; `pnpm -C init-repo build` passed.
- `pnpm -C packages/sdk-react test` — 8 files, 61 tests.
- `pnpm -C packages/server test` — 140 files, 943 passed, 1 skipped. One deliberately overloaded earlier run exceeded two task-test polling budgets; both tests passed 9/9 in isolation, and the final clean full rerun produced this result.
- `pnpm -C packages/server test:package` — packed Server starts and serves Web without repository dependencies.
- `pnpm test:local-dev-package` — the published Server artifact and real debug CLI completed one fresh builtin `localapp dev` lifecycle, including CSRF, global/application APIs, Named SQL, snapshot/reset/restore, and complete process-tree shutdown.
- `pnpm -C examples/skill-market test` — 3 tests; `pnpm -C examples/resume-manager test` — 2 tests.
- `cargo test --manifest-path packages/desktop/src-tauri/Cargo.toml` — 7 bridge/tray tests; `pnpm -C packages/desktop test` — 2 packaging tests.
- `pnpm test:real-apps` — 3 end-to-end application tests.
- `pnpm -r build` — all 10 buildable workspace projects passed.
- `pnpm test:platform-regression` — all 5 deterministic agent-first platform checks passed.
- `openspec validate --strict --all` — all 110 active specifications passed.
- Windows-target type checks for both CLI production and test branches, capability synchronization, public-source gate, Rust formatting, production-reference scan, `git diff --check`, and residual-process/listener checks passed.

## Browser evidence

### SKILL marketplace

The in-app Browser rendered the formal SKILL marketplace route successfully for `acceptance-owner`. The page showed the catalog and selected skill, and accepted a repository-local installation path below `tmp/`.

Clicking the install control created the Web request, after which the page attempted to hand it to the current computer through `localapp://`. The in-app Browser security policy blocked that external Scheme navigation. The policy boundary was not bypassed with another browser, raw CDP, shell activation, or a direct execution endpoint. Consequently, Browser evidence stops before Scheme dispatch; the independent 3/3 real-app suite supplies the complete Device Action installation evidence described above.

### Resume manager

The in-app Browser rendered the formal resume manager route successfully and completed the following visible journey:

- Uploaded a PNG and opened it in the image Lightbox.
- Uploaded the valid PDF fixture and rendered its text preview as page `1 / 1`.
- Downloaded both files and verified each download was byte-for-byte identical to its uploaded source.
- Opened a fresh formal application tab and observed an empty console with no application errors or warnings.

### Fresh builtin application

The Browser opened `http://127.0.0.1:3000/acceptance-owner/fresh-local-app/` after the real `localapp init` deployment. The formal page rendered with an empty console, and creating a work item updated the Server-backed list and status counters immediately.

## Defects found and repaired during acceptance

- Added the missing Vite `/serve` proxy so generated application content and API URLs reach the canonical Server instead of returning the Vite SPA HTML fallback.
- Aligned the template and example `pdfjs-dist` worker with `react-pdf` at version `5.4.296`, removing the API/worker version mismatch.
- Replaced the structurally invalid PDF fixture with a deterministic, valid one-page PDF that renders in PDF.js.
- Made `localapp dev` forcibly refresh CLI-owned runtime files before dependency checks, preventing a generated project from retaining a stale Vite plugin when the CLI version marker is unchanged.
- Routed packaged `/my` pages through the configured packaged Web root instead of a source-tree-relative path.
- Corrected Server `.mjs` responses to use a JavaScript MIME type so browser module loading succeeds.
- Made pnpm dependency installation explicitly independent of an unrelated parent workspace, so applications initialized below a repository `tmp/` directory receive their own dependencies instead of a false-success install with no `node_modules`.
- Forced Vite to loopback/allowed hosts and added browser-bound Origin plus HttpOnly/SameSite CSRF checks before its proxy injects the development API Key.
- Made platform proxy exceptions path-boundary aware, so overlapping application APIs such as `/api/messages` remain application-scoped while exact global APIs with query strings remain global.
- Rejected every dev-config proxy target except exact `http://127.0.0.1:<nonzero-port>` before credential injection, preventing stale or tampered configuration from forwarding the local API Key remotely.
- Added `/api/issues` and `/api/platform` to canonical platform proxying while keeping the API Key server-side.
- Restricted Dev Toolkit routes to loopback, validated application identity/path scope, and filtered diagnostics to the active user.
- Replaced predictable development credentials with stable CSPRNG values in private files (`0600` on POSIX and a current-user-only protected DACL on Windows) and removed credential values from command output.
- Split user-facing readiness from the actual listener-derived strict loopback URL, preventing a persisted public URL from receiving local development credentials.
- Added bounded structured Server readiness, full Vite/Server descendant-tree supervision (Unix process groups and atomic suspended-root assignment to a Windows kill-on-close Job Object), Node.js 24 validation, and deterministic Server launcher resolution with actionable install guidance. Both stubborn-grandchild tests passed 10 consecutive stress rounds after their handlers reported readiness.
- Prevented exact runtime refresh from truncating pnpm hard-linked package files.
- Retained each installed version's checksum-recorded migrations inside private version metadata, explicitly marked empty migration sets, backfilled old layouts from retained digest-verified packages, used only the active version for runtime reset/import validation, and blocked those internal files from raw Web serving.

## Remaining acceptance work

None within Task 16. External-Scheme navigation remains intentionally attributed to the Browser security-policy boundary described above; deterministic Device Action acceptance covers execution without bypassing that policy.

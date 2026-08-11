# Unified local acceptance — 2026-08-11

## Scope

This record covers the one-Server model, the two builtin-template applications, the generic Device Action executor, and the optional native bridge. All application data, packages, fixtures, and acceptance output are kept under the repository `tmp/` directory unless noted as an installed desktop bundle.

## Automated evidence

The following local commands passed:

- `pnpm -C init-repo test` — 23 files, 416 tests.
- `pnpm -C init-repo build`.
- `cargo test --manifest-path packages/localapp-template/Cargo.toml` — template unit and smoke tests passed.
- `cargo test --test staging` in `packages/cli` — 7 staging tests passed.
- `pnpm -C examples/skill-market test` and `pnpm -C examples/skill-market build`.
- `pnpm -C examples/resume-manager test` and `pnpm -C examples/resume-manager build`.
- `pnpm -C packages/server exec vitest run tests/device-action-executor.test.ts` — 3 tests passed.
- `pnpm test:real-apps` — both formal package installs, resume image/PDF upload and byte-for-byte download, owner filtering, deletion, and generic Device Action execution passed.

The deterministic Server acceptance suite creates a fresh loopback Server in `tmp/unified-acceptance`, installs both packages through `POST /api/me/apps/install`, and verifies:

- `http://127.0.0.1:<port>/localadmin/skill-market/` returns the formal application shell.
- `http://127.0.0.1:<port>/localadmin/resume-manager/` returns the formal application shell.
- The SKILL action creates a previously absent target root and writes only `localapp-device-actions/SKILL.md` with the expected SHA-256 digest.
- The resume application is owner-only: the owner can upload/read/delete, while unauthenticated and outsider requests are rejected; named-SQL metadata remains owner-filtered and original PNG/PDF bytes and content types are preserved.

## Native bridge and Browser evidence

The debug Tauri bundle was launched locally. It started the bundled Node Server on `127.0.0.1` and the in-app Browser rendered the formal SKILL marketplace route after local administrator login. The Browser DOM and screenshot showed the catalog, selected skill, repository-local install directory, `filesystemWrite` disclosure, and `childProcess` disabled disclosure.

The Browser click created a real pending Device Action request, but the in-app Browser security policy blocked dispatching the external `localapp://` navigation. Therefore the final Web-click → native Scheme → local trust → success observation is explicitly still pending; no alternate browser, raw CDP, or OS-level Scheme invocation was used to bypass that boundary.

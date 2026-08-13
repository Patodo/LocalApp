# Task 3 Report: scoped npm installation guidance

## RED

Command run before the documentation and Docker updates:

```bash
pnpm test:release-workflow
```

Result: failed in `public installation guidance uses the scoped registry package
while retaining the localapp command`, because README still contained
`npm install --global localapp`.

## GREEN

Commands run after the updates:

```bash
pnpm test:release-workflow
pnpm test:localapp-package
rg -n "npm (install|view|update).*localapp" README.md docs/npm-release.md docs/local-runtime.md docs/windows-local-release.md
git diff --check
```

Results: release-workflow passed 8/8; localapp-package passed 15 tests with
one Windows-only test skipped; the registry commands use `@patodo/localapp`.
The one remaining unscoped `localapp` match is the Windows local `.tgz` path,
not a registry package reference. `git diff --check` passed.

## Changed files

- `README.md`
- `docs/npm-release.md`
- `docs/local-runtime.md`
- `docs/windows-local-release.md`
- `scripts/docker-release-smoke.sh`
- `scripts/release-workflow.node-test.mjs`
- `docs/superpowers/plans/2026-08-13-npm-package-release.md`
- `.superpowers/sdd/2026-08-13-scoped-npm-package-release/task-3-report.md`

## Commit

`docs(release): document scoped npm installation`

## Concerns

No tag or release was created. Existing user-owned untracked paths were left
untouched. The superseded unscoped implementation plan is explicitly marked
historical; its completed task records were not rewritten.

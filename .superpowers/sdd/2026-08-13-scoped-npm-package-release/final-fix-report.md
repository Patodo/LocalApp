# Final Fix Report: scoped npm package release

## Changed files

- `scripts/check-npm-release.mjs`
- `scripts/check-npm-release.node-test.mjs`
- `docs/windows-local-release.md`
- `scripts/release-workflow.node-test.mjs`

## Root cause

`checkNpmRelease()` read the shared release-target manifest only for the native
adapter matrix. It duplicated the npm package name in code and never derived a
required tarball basename from `npmPackage.filenameTemplate`, so a renamed
otherwise-valid candidate passed the final gate. The Windows local-validation
guide directly ran scoped `npm pack`, which creates `patodo-localapp-<version>.tgz`,
while its installation command expected the public
`localapp-<version>.tgz` name produced by the root release wrapper.

The checker now validates the shared npm target, requires the package manifest
name to match it, derives the expected basename from its filename template and
validated version, and rejects a candidate whose path basename differs. The
Windows guide now calls `pnpm package:localapp`, and the release-workflow test
asserts that this producer is paired with the canonical install filename.

## RED

Command run after adding the focused tests and before production/documentation
edits:

```bash
node --test scripts/check-npm-release.node-test.mjs scripts/release-workflow.node-test.mjs
```

Result: exit 1; 23 passed and 4 failed (the checker parent test plus its two
new failing subtests, and the Windows documentation contract). The two new
checker failures both reported `Missing expected rejection`: a renamed
`renamed-0.1.0.tgz` was accepted and a manifest mismatching a temporary shared
npm target was accepted. The documentation assertion reported that
`docs/windows-local-release.md` did not contain `pnpm package:localapp`.

## GREEN

Focused command after the fixes:

```bash
node --test scripts/check-npm-release.node-test.mjs scripts/release-workflow.node-test.mjs
```

Result: exit 0; 27 passed, 0 failed. This includes rejection of the renamed
candidate and target/manifest drift, plus the Windows wrapper/filename contract.

Relevant release verification:

```bash
pnpm test:release-manifest
pnpm test:release-workflow
pnpm test:localapp-package
git diff --check
```

Results: release manifest 6/6 passed; release workflow 9/9 passed; localapp
package 15 passed with one expected Windows-only test skipped; `git diff --check`
passed.

## Commit

Implementation commit: `86db386eeb4a8a36ce11c6deb64f737cbab94d3e`
(`fix(release): enforce canonical npm release artifacts`)

## Concerns

None. The existing user-owned untracked paths were not touched.

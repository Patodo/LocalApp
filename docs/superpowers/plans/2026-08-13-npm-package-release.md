# LocalApp npm Package Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a complete, documented, fail-closed first-release flow for publishing the unscoped `localapp` package from the four-platform GitHub Release artifact with maintainer-controlled npm 2FA.

**Architecture:** `buildLocalAppPackage()` remains the sole package-directory builder and gains public metadata plus README/LICENSE staging. A standalone release checker inspects an already-built tgz, validates identity, version/tag agreement, required files, exact native adapter matrix, and npm dry-run behavior without publishing. The release workflow invokes that checker before creating GitHub Release assets; maintainers publish the exact downloaded tgz manually.

**Tech Stack:** Node.js 24, npm CLI, pnpm 10, GitHub Actions, Node test runner, tar/gzip npm package artifacts.

## Global Constraints

- Public npm identity is exactly `localapp`; the installed executable is exactly `localapp`.
- Initial version is `0.1.0`; release tag must equal `v<packages/localapp/package.json version>`.
- One tgz contains CLI, Server, template, and exactly `linux-x64`, `darwin-arm64`, `darwin-x64`, and `win32-x64` native adapters.
- The first npm publication is manual with maintainer 2FA; no long-lived npm token or automatic `npm publish` is added.
- The release checker may execute only `npm publish --dry-run --access public`; it must never publish.
- Root README and MIT LICENSE must be included in the published tarball.
- Existing user-owned untracked files remain untouched.

---

### Task 1: Publish-ready package metadata and documentation files

**Files:**
- Modify: `packages/localapp/package.json`
- Modify: `packages/localapp/scripts/build-package.mjs`
- Modify: `packages/localapp/scripts/pack-package.node-test.mjs`

**Interfaces:**
- Consumes: repository-root `README.md`, `LICENSE`, and source package metadata.
- Produces: `buildLocalAppPackage(options)` output containing `README.md`, `LICENSE`, and a dependency-free public `package.json` with `repository`, `homepage`, and `bugs`.

- [ ] **Step 1: Add failing package-content assertions**

Extend the extracted-tarball test to assert regular `README.md` and `LICENSE`
files exist and that the manifest contains:

```js
assert.deepEqual(manifest.repository, {
  type: "git",
  url: "git+https://github.com/Patodo/LocalApp.git",
});
assert.equal(manifest.homepage, "https://github.com/Patodo/LocalApp#readme");
assert.deepEqual(manifest.bugs, { url: "https://github.com/Patodo/LocalApp/issues" });
```

- [ ] **Step 2: Run the package test and observe RED**

Run: `node --test packages/localapp/scripts/pack-package.node-test.mjs`

Expected: FAIL because the current staging tree has no README/LICENSE and the
generated manifest omits repository links.

- [ ] **Step 3: Stage immutable public metadata**

Add the three URL fields to `packages/localapp/package.json`. In
`buildLocalAppPackage()`, copy root `README.md` and `LICENSE` into the clean
output directory using `fs.copyFile`, and project the URL fields from the
source manifest into the dependency-free generated `packageJson` object.

- [ ] **Step 4: Run the package test and observe GREEN**

Run: `node --test packages/localapp/scripts/pack-package.node-test.mjs`

Expected: PASS; extracted tarball contains documentation and no workspace or
lifecycle fields.

- [ ] **Step 5: Commit the package metadata unit**

```bash
git add packages/localapp/package.json packages/localapp/scripts/build-package.mjs packages/localapp/scripts/pack-package.node-test.mjs
git commit -m "feat(release): add public npm package metadata"
```

### Task 2: Fail-closed npm release checker

**Files:**
- Create: `scripts/check-npm-release.mjs`
- Create: `scripts/check-npm-release.node-test.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `checkNpmRelease({ tarballPath, expectedTag, runNpmDryRun }): Promise<{ name: string; version: string; targets: string[] }>`.
- CLI: `node scripts/check-npm-release.mjs --tarball <absolute-or-relative.tgz> --tag v<version>`.
- Root command: `pnpm release:npm:check -- --tarball <path> --tag v<version>`.

- [ ] **Step 1: Add failing checker contract tests**

Create synthetic tgz fixtures below repository `tmp/check-npm-release-test`.
Test one valid four-target package and rejection of: wrong package name,
tag/version mismatch, missing README/LICENSE, incomplete or extra adapter
target, lifecycle scripts, workspace dependency, second binary, unsafe archive
path, and a failed injected dry-run.

- [ ] **Step 2: Run the checker tests and observe RED**

Run: `node --test scripts/check-npm-release.node-test.mjs`

Expected: FAIL because the module and exported function do not exist.

- [ ] **Step 3: Implement archive and manifest validation**

Implement safe archive listing before extraction into a repository-local
temporary directory. Require package files `package.json`, `README.md`,
`LICENSE`, `.localapp-artifact.json`, `bin/localapp.mjs`,
`runtime/server/bin/server.mjs`, `runtime/native/adapter-manifest.json`, and
`template/package.json`. Reject absolute paths, `..`, links, unexpected binary
keys, dependencies/devDependencies, lifecycle scripts, and any native target
set other than the release target file.

- [ ] **Step 4: Implement dry-run injection and CLI behavior**

The default `runNpmDryRun` spawns exactly:

```text
npm publish --dry-run --access public <tarball>
```

The CLI requires both flags, prints a JSON success summary, and exits nonzero
with a concise error on validation or dry-run failure. No code path may spawn
`npm publish` without `--dry-run`.

- [ ] **Step 5: Run tests and observe GREEN**

Run: `node --test scripts/check-npm-release.node-test.mjs`

Expected: all checker cases pass.

- [ ] **Step 6: Commit the checker unit**

```bash
git add scripts/check-npm-release.mjs scripts/check-npm-release.node-test.mjs package.json
git commit -m "feat(release): verify npm publication candidates"
```

### Task 3: Gate GitHub Release candidates

**Files:**
- Modify: `.github/workflows/release.yml`
- Modify: `scripts/release-workflow.node-test.mjs`

**Interfaces:**
- Consumes: merged `tmp/localapp-package/localapp-<version>.tgz` and Git ref.
- Produces: GitHub Release assets only after `check-npm-release.mjs` succeeds.

- [ ] **Step 1: Add failing workflow assertions**

Require the package job to derive `expected_tag="v${version}"`, reject a tag
whose name differs, and invoke:

```text
node scripts/check-npm-release.mjs --tarball ... --tag ...
```

Also assert the workflow contains no `NPM_TOKEN`, `NODE_AUTH_TOKEN`, trusted
publishing permission, or non-dry-run `npm publish` command.

- [ ] **Step 2: Run the workflow test and observe RED**

Run: `node --test scripts/release-workflow.node-test.mjs`

Expected: FAIL because no npm candidate gate exists.

- [ ] **Step 3: Add tag and tarball release gates**

In the package job, validate tag/version agreement for tag-triggered runs and
run the checker against the exact generated tarball before manifest generation
and artifact upload. For manual workflow dispatch, pass the synthesized
`v<version>` expected tag without pretending it is a public release.

- [ ] **Step 4: Run workflow tests and observe GREEN**

Run: `node --test scripts/release-workflow.node-test.mjs scripts/check-npm-release.node-test.mjs`

Expected: PASS and no automatic npm publication credential or command exists.

- [ ] **Step 5: Commit workflow gating**

```bash
git add .github/workflows/release.yml scripts/release-workflow.node-test.mjs
git commit -m "ci(release): gate npm release candidates"
```

### Task 4: Maintainer release guide

**Files:**
- Create: `docs/npm-release.md`
- Modify: `README.md`
- Modify: `docs/windows-local-release.md`

**Interfaces:**
- Produces: one canonical first-release runbook linked from README and the
  platform release guide.

- [ ] **Step 1: Write the canonical runbook**

Document: npm account and 2FA prerequisites; registry/name checks; version
bump and clean-main checks; annotated tag creation; GitHub workflow status;
artifact and SHA256SUMS download; local checksum verification; release checker;
`npm login`; `npm whoami`; exact public publish command; `npm view`; clean-prefix
install; daemon smoke test; immutable-version retry rules; and the later OIDC
migration boundary.

- [ ] **Step 2: Link existing user and Windows documentation**

Add `docs/npm-release.md` to README's design/release links. Replace the bare
Windows `npm publish` snippet with a link to the canonical runbook and state
that only the four-target CI tgz may be published.

- [ ] **Step 3: Verify documentation consistency**

Run:

```bash
rg -n "npm publish|localapp-<version>|release:npm:check|Trusted Publishing" README.md docs .github/workflows/release.yml
git diff --check
```

Expected: one canonical manual publication flow, no instruction to publish a
host-only local artifact, and no whitespace errors.

- [ ] **Step 4: Commit release documentation**

```bash
git add README.md docs/npm-release.md docs/windows-local-release.md
git commit -m "docs: add npm release runbook"
```

### Task 5: Final package and release verification

**Files:**
- Modify only if a verified defect is found in files already owned by Tasks 1–4.

**Interfaces:**
- Consumes: final worktree and host-only development tarball.
- Produces: evidence that package metadata, checker behavior, release workflow,
  and existing single-package constraints remain green.

- [ ] **Step 1: Run the complete release test matrix**

Run:

```bash
pnpm test:localapp-package
pnpm test:release-workflow
pnpm test:release-manifest
pnpm test:brand
npm run package:localapp
```

Expected: all applicable tests pass; platform-specific skips are reported, not
treated as failures.

- [ ] **Step 2: Inspect the development tarball**

Run `npm publish --dry-run --access public tmp/localapp-package/localapp-0.1.0.tgz`
to verify npm acceptance and inspect README/LICENSE plus metadata. Do not run
the strict four-target checker on this host-only tarball; its deliberate
failure is covered by the checker test suite.

- [ ] **Step 3: Review and push**

Run `git diff --check`, inspect all commits and untracked files, preserve
user-owned untracked paths, then push `main` only after the tree's tracked
changes are committed.

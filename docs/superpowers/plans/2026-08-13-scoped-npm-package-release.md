# Scoped npm Package Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish LocalApp 0.1.0 as the public npm package `@patodo/localapp` while preserving the `localapp` CLI, release asset, Scheme, daemon, and runtime identities.

**Architecture:** Treat npm registry identity as package metadata, not as the product's operating-system identity. The shared release target manifest is the source of truth for `@patodo/localapp`; builders and fail-closed release checks consume it while continuing to emit `localapp-<version>.tgz` and `bin.localapp`.

**Tech Stack:** Node.js 24, TypeScript, npm, pnpm, Node test runner, GitHub Actions, native adapters for darwin-arm64, darwin-x64, linux-x64, and win32-x64.

## Global Constraints

- Public npm identity is exactly `@patodo/localapp`; the installed executable is exactly `localapp`.
- Initial scoped version is `0.1.0`; release tag remains exactly `v0.1.0`.
- GitHub Release asset remains exactly `localapp-0.1.0.tgz`.
- `localapp://`, daemon names, support/data directories, and application package contracts do not change.
- The package contains no workspace dependencies, lifecycle install scripts, Tauri/Desktop product, or second executable.
- Only the four-platform GitHub Release tarball may be published; host-only packages are test artifacts.
- All test projects, package installs, and downloads remain below this repository's `tmp/` directory.

---

### Task 1: Make scoped package identity a tested build contract

**Files:**
- Modify: `packages/localapp/package.json`
- Modify: `packages/shared/release-targets.json`
- Modify: `packages/localapp/scripts/build-package.mjs`
- Modify: `packages/localapp/scripts/pack-package.node-test.mjs`
- Modify: `scripts/single-package-cutover.node-test.mjs`
- Modify: `packages/server/scripts/localapp-dev-package.node-test.mjs`
- Modify: `packages/localapp/tests/server-command.test.ts`

**Interfaces:**
- Consumes: `release-targets.json.npmPackage.name` and `filenameTemplate`.
- Produces: package manifest `{ name: "@patodo/localapp", bin: { localapp: "bin/localapp.mjs" } }` and npm's scoped installation path `node_modules/@patodo/localapp`.

- [ ] **Step 1: Write failing package tests**

Change assertions to require:

```js
assert.equal(manifest.name, "@patodo/localapp");
assert.deepEqual(manifest.bin, { localapp: "bin/localapp.mjs" });
```

Resolve installed files below `node_modules/@patodo/localapp` while invoking the executable through `node_modules/.bin/localapp`.

- [ ] **Step 2: Run tests and verify the old unscoped manifest fails**

Run:

```bash
pnpm test:localapp-package
pnpm -C packages/localapp test -- --run tests/server-command.test.ts
```

Expected: FAIL on package name or the old unscoped installation path.

- [ ] **Step 3: Implement the scoped manifest contract**

Set both source manifests to:

```json
"name": "@patodo/localapp"
```

Keep:

```json
"filenameTemplate": "localapp-{version}.tgz"
```

Update build artifact validation to require `@patodo/localapp` without changing `bin.localapp`, tarball naming, runtime paths, or Scheme behavior.

- [ ] **Step 4: Run focused package tests**

Run the commands from Step 2. Expected: PASS, with the platform-specific Windows test skipped only outside Windows.

- [ ] **Step 5: Commit**

```bash
git add packages/localapp/package.json packages/shared/release-targets.json packages/localapp/scripts/build-package.mjs packages/localapp/scripts/pack-package.node-test.mjs scripts/single-package-cutover.node-test.mjs packages/server/scripts/localapp-dev-package.node-test.mjs packages/localapp/tests/server-command.test.ts
git commit -m "fix(release): scope the npm package identity"
```

### Task 2: Make release metadata and publication checks fail closed on the scope

**Files:**
- Modify: `scripts/check-npm-release.mjs`
- Modify: `scripts/check-npm-release.node-test.mjs`
- Modify: `scripts/generate-release-manifest.mjs`
- Modify: `scripts/generate-release-manifest.node-test.mjs`
- Modify: `packages/localapp/scripts/build-package.node-test.mjs`

**Interfaces:**
- Consumes: the scoped package manifest and shared release target manifest.
- Produces: strict check result `{ name: "@patodo/localapp", version: "0.1.0", targets: [...] }` and release asset metadata with `package: "@patodo/localapp"`.

- [ ] **Step 1: Write failing checker and manifest tests**

Require the checker to reject `localapp` and accept only `@patodo/localapp`. Require generated release metadata to contain:

```json
{ "kind": "npm", "package": "@patodo/localapp", "filename": "localapp-1.2.3.tgz" }
```

- [ ] **Step 2: Verify RED**

Run:

```bash
node --test scripts/check-npm-release.node-test.mjs scripts/generate-release-manifest.node-test.mjs
```

Expected: FAIL because production checks still require `localapp`.

- [ ] **Step 3: Implement minimal scoped checks**

Replace only npm identity checks with `@patodo/localapp`. Preserve archive safety, exact adapter matrix checks, `npm publish --dry-run --access public`, and the `localapp-<version>.tgz` filename.

- [ ] **Step 4: Verify GREEN**

Run the command from Step 2 and `pnpm test:release-manifest`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/check-npm-release.mjs scripts/check-npm-release.node-test.mjs scripts/generate-release-manifest.mjs scripts/generate-release-manifest.node-test.mjs packages/localapp/scripts/build-package.node-test.mjs
git commit -m "fix(release): validate scoped npm artifacts"
```

### Task 3: Update installation paths and public release guidance

**Files:**
- Modify: `README.md`
- Modify: `docs/npm-release.md`
- Modify: `docs/local-runtime.md`
- Modify: `docs/windows-local-release.md`
- Modify: `scripts/docker-release-smoke.sh`
- Modify: `scripts/release-workflow.node-test.mjs`
- Modify: `docs/superpowers/plans/2026-08-13-npm-package-release.md`

**Interfaces:**
- Consumes: `@patodo/localapp` registry identity.
- Produces: user commands `npm install --global @patodo/localapp` and `npx --package @patodo/localapp localapp`; Docker inspection path `/usr/local/lib/node_modules/@patodo/localapp`.

- [ ] **Step 1: Write failing documentation and Docker contract assertions**

Require supported current docs to contain scoped install/view commands and reject unscoped registry commands. Require Docker smoke inspection to use the scoped global package directory.

- [ ] **Step 2: Verify RED**

Run:

```bash
pnpm test:release-workflow
pnpm test:localapp-package
```

Expected: FAIL on old install or Docker package paths.

- [ ] **Step 3: Update current documentation and Docker inspection**

Use:

```bash
npm install --global @patodo/localapp
npm view @patodo/localapp@<version>
npx --package @patodo/localapp localapp --version
```

Keep every CLI example after installation as `localapp ...`. Mark the superseded unscoped implementation plan as historical rather than rewriting completed task records as if they had originally used the scope.

- [ ] **Step 4: Verify docs and release tests**

Run Step 2 plus:

```bash
rg -n "npm (install|view|update).*localapp" README.md docs/npm-release.md docs/local-runtime.md docs/windows-local-release.md
```

Expected: registry package references are scoped; CLI command references remain unscoped.

- [ ] **Step 5: Commit**

```bash
git add README.md docs/npm-release.md docs/local-runtime.md docs/windows-local-release.md scripts/docker-release-smoke.sh scripts/release-workflow.node-test.mjs docs/superpowers/plans/2026-08-13-npm-package-release.md
git commit -m "docs(release): document scoped npm installation"
```

### Task 4: Build and verify the scoped four-platform release candidate

**Files:**
- Generated only: `tmp/npm-release-0.1.0-scoped/`
- GitHub state: tag `v0.1.0`, Release assets, Release workflow.

**Interfaces:**
- Consumes: tested source at `main` and the four native adapter jobs.
- Produces: one immutable candidate `localapp-0.1.0.tgz` whose manifest name is `@patodo/localapp`.

- [ ] **Step 1: Run local release gates**

```bash
pnpm test:localapp-package
pnpm test:release-manifest
pnpm test:release-workflow
pnpm test:public-source
pnpm package:localapp
git diff --check
```

- [ ] **Step 2: Push source commits**

```bash
git push origin main
```

- [ ] **Step 3: Prove the scoped version is unpublished**

```bash
npm view @patodo/localapp@0.1.0 version
```

Expected: npm E404.

- [ ] **Step 4: Replace only the unpublished failed candidate**

Delete the existing GitHub `v0.1.0` Release and move tag `v0.1.0` to the scoped source commit only after Step 3 proves npm has no immutable scoped version.

- [ ] **Step 5: Monitor the complete Release workflow**

Require success from source-gate, all four native adapters, package, and image jobs.

- [ ] **Step 6: Download and verify exact assets**

```bash
gh release download v0.1.0 --dir tmp/npm-release-0.1.0-scoped
cd tmp/npm-release-0.1.0-scoped
shasum -a 256 -c SHA256SUMS
cd ../..
pnpm release:npm:check -- --tarball tmp/npm-release-0.1.0-scoped/localapp-0.1.0.tgz --tag v0.1.0
```

Expected checker identity: `@patodo/localapp`; targets: darwin-arm64, darwin-x64, linux-x64, win32-x64.

### Task 5: Publish and independently verify npm registry installation

**Files:**
- Generated only: `tmp/npm-registry-smoke-0.1.0/`

**Interfaces:**
- Consumes: the checksum-verified GitHub Release tarball.
- Produces: immutable public npm version `@patodo/localapp@0.1.0` with dist-tag `latest`.

- [ ] **Step 1: Publish the exact candidate**

```bash
npm publish tmp/npm-release-0.1.0-scoped/localapp-0.1.0.tgz --access public --registry https://registry.npmjs.org/
```

Complete npm browser/2FA authentication if requested.

- [ ] **Step 2: Verify registry metadata**

```bash
npm view @patodo/localapp@0.1.0 name version bin dist.tarball dist.integrity --json
```

Expected: name `@patodo/localapp`, version `0.1.0`, and bin `localapp`.

- [ ] **Step 3: Install from the registry in a clean project directory**

```bash
mkdir -p tmp/npm-registry-smoke-0.1.0
npm install --prefix tmp/npm-registry-smoke-0.1.0 @patodo/localapp@0.1.0
tmp/npm-registry-smoke-0.1.0/node_modules/.bin/localapp --version
```

Expected: `localapp 0.1.0`.

- [ ] **Step 4: Start the registry-installed Server**

Run `localapp server run` with data below `tmp/npm-registry-smoke-0.1.0/data`, verify `/health` and `/setup` return HTTP 200, then terminate the foreground process cleanly.

- [ ] **Step 5: Record final state**

Confirm `main` equals tag `v0.1.0`, the GitHub Release and npm registry identities agree, no test server remains, and user-owned untracked files are untouched.

# LocalApp npm Package Release Design

**Date:** 2026-08-13
**Status:** Approved for implementation

## Objective

Publish the public package as `@patodo/localapp`. Users install one artifact
with `npm install --global @patodo/localapp` and invoke the `localapp` binary.
The package contains the TypeScript CLI, canonical Server, builtin application
template, and the verified native adapter matrix. It does not publish separate
platform packages, a Tauri application, or another Server package.

## First-release boundary

The first npm release uses a deliberate two-stage process:

1. A signed Git tag on `main` triggers GitHub Actions. CI builds the Linux x64,
   macOS arm64, macOS x64, and Windows x64 native adapters, combines them with
   the platform-neutral Node product, verifies the complete tarball, and
   publishes immutable GitHub Release assets.
2. A maintainer downloads that exact CI-produced tarball, authenticates to npm
   with publishing 2FA, runs a dry-run check, and explicitly runs `npm publish`.

The repository does not store a long-lived npm publication token. Trusted
Publishing through GitHub OIDC is the intended later automation, after the
first public package exists and its npm package settings can be bound to the
release workflow.

## Package identity and metadata

The public package identity is fixed as:

```text
name: @patodo/localapp
binary: localapp
initial version: 0.1.0
registry: https://registry.npmjs.org/
access: public
```

The published manifest contains no workspace dependencies, development
dependencies, or lifecycle scripts. It includes a useful description,
license, repository, homepage, bugs URL, Node engine requirement, and the
single `localapp` binary mapping. The tarball includes the repository README
and MIT license so the npm package page and installed package are
self-describing.

## Release data flow

The existing release workflow remains the only producer of a public release
candidate:

```text
main commit
  -> tag v<version>
  -> source and specification gates
  -> four native adapter jobs
  -> one merged localapp-<version>.tgz
  -> package/release checks
  -> GitHub Release + SHA256SUMS + release-manifest.json
  -> maintainer npm dry-run
  -> maintainer npm publish with 2FA
```

Local `npm run package:localapp` remains useful for development and host
acceptance, but a host-only tarball is not an npm release candidate. Only a
tarball assembled from the exact release adapter matrix may pass the npm
release check.

## Release checks

One reusable release checker accepts a tarball path and fails closed unless:

- the filename remains `localapp-<version>.tgz`, and its version agrees with
  the manifest version and requested Git tag;
- the package name is exactly `@patodo/localapp` and the binary is exactly
  `localapp`;
- README, LICENSE, runtime, template, Server entrypoint, and artifact manifest
  are present;
- the native adapter manifest contains exactly the supported release targets;
- no workspace dependency, lifecycle script, Tauri/Desktop product, secret,
  or unexpected second executable is present;
- `npm publish --dry-run --access public` accepts the resulting artifact.

The checker must not publish. Actual publication remains a separate command
that a maintainer copies from the release guide and confirms through npm 2FA.

## Version and tag policy

`packages/localapp/package.json` is the source of truth for the npm version.
A release tag must equal `v<package version>`, for example `v0.1.0`. The
workflow rejects mismatches before building release assets. Published npm
versions are immutable; every later release increments the package version
before creating its tag.

## Failure handling

- If source, native adapter, package, or dry-run verification fails, no npm
  publication command is run.
- If GitHub Release creation fails, the npm publication is blocked because no
  canonical release candidate exists.
- If npm authentication or 2FA fails, the GitHub Release remains intact and
  the maintainer retries publication with the same verified tarball.
- If npm reports that the version already exists, the artifact is not
  republished. The maintainer verifies the existing version or creates a new
  patch release.
- npm rejected the unscoped `localapp` name because it is too similar to the
  existing `local-app` package. The approved public identity is therefore
  `@patodo/localapp`; release tooling must not fall back to another name.

## Documentation and verification

The release guide documents account prerequisites, tag creation, workflow
observation, artifact download, checksum verification, dry-run, publication,
and clean-prefix installation. Automated tests cover package metadata,
README/LICENSE inclusion, exact adapter targets, tag/version matching, and the
non-publishing behavior of the checker.

The post-publication acceptance is:

```bash
npm view @patodo/localapp@<version>
npm install --global @patodo/localapp@<version>
localapp --version
localapp server
localapp server status
```

The first public release is complete only after npm reports the expected
version and a clean installation can start the packaged Server.

## Stable product names

The npm registry identity is the only scoped name. The executable remains
`localapp`; the custom URL scheme remains `localapp://`; daemon, support and
data directories remain named `localapp`; the Git tag remains `v<version>`;
and the GitHub Release tarball remains `localapp-<version>.tgz`. This avoids a
registry policy constraint leaking into operating-system integration or the
application package protocol.

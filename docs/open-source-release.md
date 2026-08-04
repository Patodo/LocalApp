# Public source release

LocalApp's first public GitHub repository must be created from a checked source
snapshot. Do not push the internal repository, rewrite its history, or force
push a filtered copy of that history.

## 1. Prepare an internal commit

Use a clean, reviewed commit and run the normal verification suite:

```bash
git status --short
openspec validate --all --strict
```

Record the full commit SHA. The exporter reads only Git objects from that
commit, so uncommitted files are never included.

## 2. Export and verify

Choose an empty directory outside the internal repository:

```bash
SOURCE_COMMIT="$(git rev-parse HEAD)"
PUBLIC_DIR="$(mktemp -d)/localapp"
pnpm export:public-source \
  --commit "$SOURCE_COMMIT" \
  --output "$PUBLIC_DIR" \
  --verify
```

The command applies a top-level allowlist, preserves sanitized OpenSpec archives,
and rejects release binaries, oversized files, private keys, likely credentials,
internal domains, personal test identities, and machine-specific paths. It writes
`public-source-manifest.json` with the source commit, sorted file list, sizes,
per-file SHA-256 values, and an aggregate content digest.

Review the output and manifest before publishing:

```bash
find "$PUBLIC_DIR" -maxdepth 2 -type f | sort
git -C "$PUBLIC_DIR" diff --no-index /dev/null public-source-manifest.json
```

## 3. Create a new public history

Initialize a new repository inside the snapshot. This creates an intentional
public root commit with no relationship to internal Git objects:

```bash
git -C "$PUBLIC_DIR" init --initial-branch=main
git -C "$PUBLIC_DIR" add .
git -C "$PUBLIC_DIR" commit -m "chore: publish LocalApp source"
git -C "$PUBLIC_DIR" remote add origin git@github.com:OWNER/localapp.git
git -C "$PUBLIC_DIR" push -u origin main
```

Replace `OWNER` only after confirming the destination organization and repository.
Branch protection, required CI, secret scanning, Dependabot, private vulnerability
reporting, and release environment approvals should be enabled before accepting
external contributions.

## 4. Publish later snapshots

For later releases, export another reviewed internal commit to a new empty
directory, compare its manifest with the previous public snapshot, and apply the
source changes as a normal public commit. Never copy `.git`, unfinished internal
OpenSpec changes, runtime data, release binaries, or internal deployment records.
Archived OpenSpec changes may be published only after they pass the same
sensitive-content gate as source code.

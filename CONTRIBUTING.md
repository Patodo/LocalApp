# Contributing to LocalApp

Thank you for helping improve LocalApp. The project welcomes bug reports,
documentation improvements, application templates, and focused code changes.

## Development setup

Install Node.js, pnpm, Rust, and the OpenSpec CLI, then run:

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm -C packages/server test
pnpm -C packages/web test
cargo test --manifest-path packages/cli/Cargo.toml
openspec validate --all --strict
```

Start the development services with `pnpm dev`. The platform is available at
`http://localhost:3000`; the Next.js development process listens on port 3001
behind the platform server.

## Changes

- Open an OpenSpec change for new capabilities or behavior changes.
- Keep changes scoped and include tests for observable behavior.
- Use Named SQL and transaction mutations for application backend logic by
  default. Do not introduce arbitrary hosted code as a shortcut.
- Do not commit credentials, local data, generated release assets, or machine
  specific paths.
- Run the tests relevant to your change and `openspec validate --all --strict`.

Commit messages follow Conventional Commits. Pull requests should explain the
user impact, verification performed, and any migration or compatibility risk.

## Community applications

Community application submissions should include source, migrations, Named SQL
contracts, a manifest, screenshots, and a license. Applications must not embed
credentials or depend on undocumented platform internals.

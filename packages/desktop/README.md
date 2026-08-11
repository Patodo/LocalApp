# LocalApp native bridge

The desktop package is a windowless Tauri bridge. It starts the exact
`@localapp/server` Node artifact, keeps the Server on loopback by default, and
provides only two tray actions: `打开主页` and `退出本地服务`.

The bridge registers `localapp://` for generic Device Action tickets. It never
downloads scripts or decides trust; it forwards a validated ticket to the
child Server through the per-process loopback control token. Trust, execution,
permissions, and the Web management page remain Server-owned.

## Development and tests

```bash
pnpm --filter @localapp/desktop test
cargo test --manifest-path packages/desktop/src-tauri/Cargo.toml
pnpm --filter @localapp/desktop tauri build --debug --bundles app
```

`bundle-server.mjs` produces the same standalone Server artifact used by the
Node distribution. `bundle-node-runtime.mjs` verifies a pinned Node 24 runtime
and downloads it into the project `tmp/` cache when a local copy is absent.

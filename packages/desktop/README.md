# LocalApp Desktop

LocalApp Desktop is the Windows-first local application manager and companion
for LocalApp Server. It installs `.localapp` packages, runs multiple local apps
through one MiniServer, opens them in the default browser, and can publish an
app to an explicitly selected Server profile. A remote LocalApp deployment is
not required for personal local use.

## Development

From the repository root, install the locked workspace and run the desktop package:

```bash
pnpm install --frozen-lockfile
pnpm --filter @localapp/desktop test
pnpm --filter @localapp/desktop test:runner
pnpm --filter @localapp/desktop test:runtime
pnpm --filter @localapp/desktop test:local-runtime-bundle
pnpm --filter @localapp/desktop test:release-config
pnpm --filter @localapp/desktop tauri dev
```

The Tauri wrapper prepares the pinned Node runtime and bundled Local Runtime
before `dev`, `build`, or `bundle`. On macOS the real Tauri window validates the
local application library, Server profiles, publishing, task trust UI, fixed
shell scrolling, configuration, Rust commands, single-instance focus, and
runner protocol. Windows remains necessary for NSIS/WebView2 installation,
Authenticode/updater signing, native notifications, tray/autostart, protocol
registration, and Windows process-tree behavior.

## Local Applications

Build and install an application from its repository:

```bash
localapp build --package
localapp local install
```

Desktop owns the installed package, version history, and isolated data
directory. Starting an app lazily starts one shared MiniServer and opens the
app's `<app>.localhost` URL in the default browser. Updating or uninstalling an
app does not delete its SQLite database or files. Data deletion is a separate
explicit operation.

The Server workspace manages named remote profiles. Publishing always requires
an explicit target profile and does not upload local databases or files.

## Windows Builds

Windows x64 is the supported distribution target. A local compile without an installer is:

```powershell
pnpm install --frozen-lockfile
pnpm --filter @localapp/desktop test
cargo test --locked --manifest-path packages/desktop/src-tauri/Cargo.toml --target x86_64-pc-windows-msvc
pnpm --filter @localapp/desktop tauri build --no-bundle --target x86_64-pc-windows-msvc
pnpm --filter @localapp/desktop test:bundle-e2e --target x86_64-pc-windows-msvc
```

Release packaging first generates a temporary merge config and then builds NSIS:

```powershell
node packages/desktop/scripts/windows-release-config.mjs --output "$env:TEMP\localapp-tauri-release.json"
pnpm --filter @localapp/desktop tauri build --bundles nsis --target x86_64-pc-windows-msvc --config "$env:TEMP\localapp-tauri-release.json"
```

For the complete local setup, Test/Release, signing, checksum, upload, and
clean-VM procedure, see [Local Windows release](../../docs/windows-local-release.md).

`tauri.windows.conf.json` selects an NSIS current-user installation, so elevation is not required. The `localapp://` deep-link scheme remains in the main Tauri config and is inherited by the Windows merge. Desktop state lives separately under `%LOCALAPPDATA%\com.localapp.desktop`, so installer replacement or removal cannot delete trust records, task history, settings, logs, or dependency caches. LocalApp does not import state from installations made under another product identity.

The installer embeds Microsoft's WebView2 offline installer. This lets a machine without network access install and launch LocalApp even when WebView2 is absent, at an installer cost of roughly 127 MB compared with the download bootstrapper. A fixed WebView2 runtime would be larger (roughly 180 MB) and would shift browser security patch ownership to each LocalApp release, so it is not used.

## Release Secrets

The Windows workflow uses these GitHub secrets:

| Secret | Required | Purpose |
| --- | --- | --- |
| `LOCALAPP_UPDATER_ENDPOINT` | Yes | HTTPS updater endpoint; Tauri variables such as `{{target}}`, `{{arch}}`, and `{{current_version}}` are allowed. |
| `LOCALAPP_UPDATER_PUBKEY` | Yes | Public updater verification key embedded in release config. |
| `TAURI_SIGNING_PRIVATE_KEY` | Yes | Private key used by Tauri to sign updater artifacts. |
| `LOCALAPP_WINDOWS_CERTIFICATE_PFX_BASE64` | Optional | Base64-encoded Authenticode PFX, imported only into the ephemeral runner certificate store. |
| `LOCALAPP_WINDOWS_CERTIFICATE_PFX_PASSWORD` | With protected PFX | Password used while importing the PFX. |
| `LOCALAPP_WINDOWS_CERTIFICATE_THUMBPRINT` | With PFX | SHA-1 certificate thumbprint passed to the Windows bundler. |
| `LOCALAPP_WINDOWS_TIMESTAMP_URL` | Optional with PFX | HTTPS Authenticode timestamp service. |

Release config generation fails closed when either updater endpoint or public key is missing, and rejects non-HTTPS updater or timestamp URLs. The generated JSON contains only public updater/signing metadata. PFX bytes, PFX passwords, updater private keys, and private-key passwords are never written to it.

## Offline Boundary

No system Node.js or npm installation is required. The installer carries the
manifest-pinned Windows x64 Node binary, npm CLI resources, LocalApp runner,
Local Runtime, and SQLite WASM. CI verifies the downloaded archive SHA-256,
generated marker, binary hash, source resources, and the final NSIS archive
contents.

Offline installation, launch, and installed local application use are
supported. Publishing, shared platform capabilities, and the first preparation
of an uncached npm dependency require network access to the selected Server or
npm registry. Cached pure-JavaScript environments continue to work without a
system Node installation; native addons are outside the supported boundary.

The settings view clears cached dependency environments only while no local task is active. Logout clears the shared CLI API key and restarts Desktop so the old in-memory credential cannot be reused; when `LOCALAPP_API_KEY` is supplied by the environment, logout is intentionally disabled until that managed variable is removed.

## Windows VM Acceptance

Task 9.4 remains a real Windows x64 VM acceptance gate. Validate the harness on the development machine or in CI:

```powershell
pnpm --filter @localapp/desktop test:windows-acceptance
```

Then copy the installers and acceptance script to a clean Windows x64 VM with a non-administrator user profile, no system Node.js/npm installation, and no preinstalled WebView2 Runtime. Windows 11 normally includes WebView2, so use a clean Windows 10 image when the Windows 11 image cannot prove the Runtime-absent precondition. Run only the PowerShell harness on that VM:

```powershell
powershell -ExecutionPolicy Bypass -File packages/desktop/scripts/windows-vm-acceptance.ps1 `
  -Installer C:\acceptance\LocalApp-current-setup.exe `
  -ExpectedSha256 "REPLACE_WITH_CURRENT_INSTALLER_SHA256" `
  -PreviousInstaller C:\acceptance\LocalApp-previous-setup.exe `
  -PreviousSha256 "REPLACE_WITH_PREVIOUS_INSTALLER_SHA256" `
  -RequireDisconnected `
  -RequireWebView2Absent `
  -InteractiveChecks `
  -UninstallAfter `
  -ReportPath C:\acceptance\localapp-windows-acceptance.json
```

The script fails unless the VM is Windows x64, non-administrator, and has no
`node` or `npm` on `PATH`. `-RequireWebView2Absent` uses Microsoft's documented
WebView2 Runtime registry keys to prove the Runtime is absent before
installation and detectable after the offline installer runs. The current
installer hash is mandatory; a previous installer also requires its hash. It
verifies current-user placement, bundled runtime assets, protocol registration,
startup, isolated SQLite state, upgrade preservation, and optional uninstall
preservation. Interactive confirmations include installing and opening two
local applications through one MiniServer, offline launch, notifications,
favorites, deep links, actions, Windows descendant-process cancellation, proxy
installation, updater rejection, autostart, and tray behavior. Omitting
`-InteractiveChecks` records those checks as `not-run` and sets the report
status to `automation-passed-manual-not-run`; that report is useful for
automation but does not complete the acceptance gate.

Copy the generated JSON report back to a development checkout and validate that it is sufficient to close the OpenSpec gate:

```powershell
node packages/desktop/scripts/windows-vm-acceptance-report.mjs C:\acceptance\localapp-windows-acceptance.json
```

The validator rejects reports that do not explicitly prove Windows x64, a non-administrator account, no system Node.js/npm, disconnection at installation time, the WebView2-absent precondition, previous-version upgrade and uninstall preservation, or every interactive check. Automation-only reports remain insufficient.

- Disconnect the VM, install the NSIS package, launch LocalApp, and confirm no WebView2 download is attempted.
- Install two `.localapp` packages, open both in the browser, and confirm one Desktop MiniServer serves isolated content and databases without system Node.js.
- Confirm the app installs under the current user, survives sign-out/reboot, and autostart can be enabled and disabled.
- Open a `localapp://` action URL and confirm the existing process is activated and receives the request once.
- Verify Windows notifications, notification click-through, favorites, tray behavior, and browser opening against a reachable test server.
- Execute a trusted pure-JavaScript action and an action that prepares an exact npm dependency through the configured registry/proxy, with no system Node on `PATH`.
- Cancel and time out an action that starts a descendant process, then confirm the complete Windows process tree has terminated.
- Install an older signed build, create trust/history/settings/cache data, upgrade through the signed updater, and confirm `%LOCALAPPDATA%\com.localapp.desktop` is preserved.
- Confirm tampered updater metadata, signature, sidecar marker, or binary is rejected and produces no duplicate execution.

GitHub Actions and macOS development builds provide compilation and artifact checks only; neither is evidence that these Windows installation and upgrade behaviors passed.

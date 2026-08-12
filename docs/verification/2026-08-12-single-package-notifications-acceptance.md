# Single-package LocalApp acceptance

Date: 2026-08-13 (Asia/Tokyo)

## Product under test

- Source baseline before this acceptance change: `c15360e`.
- Artifact: `tmp/localapp-package/localapp-0.1.0.tgz`.
- SHA-256: `522442d78fcf0de3e6a5c907dd01e6aaf140e219715c8c583c8a89c2be1b15e9`.
- Installation: clean npm prefix under `tmp/single-package-acceptance/npm-prefix`; no workspace launcher was used.
- Server: `http://127.0.0.1:58097`, bound to loopback.
- Service mode on this checkout: `external-volume-daemon`. macOS launchd cannot execute a user service directly from this external `/Volumes` checkout, so the acceptance harness starts the same packed `_daemon` detached after unregistering the failed LaunchAgent. This fallback is limited to repository-local acceptance.
- Formal applications:
  - `http://127.0.0.1:58097/localadmin/skill-market/`
  - `http://127.0.0.1:58097/localadmin/resume-manager/`

The state file contains a local acceptance API Key and remains ignored below `tmp/`; its value is not recorded here.

## Packaged lifecycle and applications

`npm run acceptance:local:start` built the single npm artifact, installed it into a clean prefix, initialized a fresh multi-user Server, created a CLI profile, built both applications with the installed CLI and installed them through formal package endpoints. `localapp server status` reported the dynamic loopback URL and first-run setup URL through daemon IPC.

The final rebuilt resume application was exercised with `browser:control-in-app-browser` from its formal route:

- Uploaded `examples/resume-manager/fixtures/portrait.png` with the real file chooser.
- Observed the image lightbox and accessible image label.
- Downloaded the protected original to `tmp/single-package-acceptance/downloads/portrait.png`; SHA-256 matched the fixture: `a9999e0d435c0ae65cfc4987617d991876f72a16d2ddab4298e444d8312bfee4`.
- Uploaded `examples/resume-manager/fixtures/resume.pdf` with the real file chooser.
- Observed extracted page content and `第 1 / 1 页` in the PDF preview.
- Downloaded the protected original to `tmp/single-package-acceptance/downloads/resume.pdf`; SHA-256 matched the fixture: `bed8453aa5427a7c08f64ed32e1bb19537c665b9c0737f2b1ac63958e0882511`.
- Browser console warning/error capture was empty after the application mounted. The earlier blank snapshot was a capture-before-mount timing issue, not an application failure. Final content keys were `6195cb5a9365ae5e49d1.png` and `9c4f31491c40ac04677e.pdf`; copies under the acceptance downloads directory matched the fixtures byte-for-byte.

## Scheme and SKILL market

The formal SKILL market rendered, accepted the repository-local destination and created Device Action request `844526a6-9f90-4c6c-b66b-b41f7a51e79d`. The page reached `等待本机激活` and attempted its `localapp://` activation.

The in-app Browser security policy blocked automated external-Scheme navigation. The acceptance did not bypass that boundary with shell activation, a raw API call, another browser or direct CDP. The deterministic real-app suite separately verifies the generic action ticket, local trust and exact fixture installation under `tmp/single-package-acceptance/installed-skills/localapp-device-actions/SKILL.md`. A final user-level click remains the required observation for Browser-to-LaunchServices dispatch.

## Native notifications

The Web Device Notifications page enabled the current Server source and showed daemon/native adapter `0.1.0`. macOS initially reported notifications denied; the OS setting for `LocalApp Bridge` was explicitly enabled, after which the test command completed as `已显示`.

Real application mention notifications exposed a macOS adapter defect: `UNNotificationAttachment` consumed the shared icon inside the immutable installed release, causing later deliveries to fail. The bridge now copies the verified icon into a unique staged directory for every request and removes only that staging directory. Repeated native delivery advanced the durable cursor, retained the release icon with SHA-256 `4498c4aee99b2a6ffd706f8115153525542d3a0f76fbcdc4a47b77ec92b93547`, and created a one-time click ticket without persisting the raw ticket outside daemon state.

After the final artifact rebuild, the fresh `58097` Device Notifications page again reported integration available, OS permission allowed, daemon/native adapter `0.1.0`, source connected with cursor `0`, and the explicit test completed as `已显示`.

The source Web inbox contained the application mention and subscription rows. Notification click resolution, read marking and offline ordered catch-up are also covered by the notification manager, dispatcher, source connection and Server integration suites; a real macOS click is included in the remaining manual handoff with the Scheme click.

## Final review repairs

The final diff review found and repaired credential-bearing acceptance command logs, missing runtime ignore rules, Windows scheduled-task runtime layout propagation, an ambiguous external-volume LaunchServices skip, a fallback-scope error, stale subcommand-help guidance and the stale artifact digest. Windows service metadata contains only the three validated runtime layout variables; the stable launcher validates the file before applying it. Native adapter tests now report external-volume LaunchServices dispatch as an explicit skipped subtest instead of silently treating it as exercised.

## Reproduction

```bash
npm run acceptance:local:start
pnpm test:localapp-package
pnpm test:real-apps
pnpm -C packages/localapp test:native
npm run acceptance:local:stop
```

All generated state and evidence stays below the repository `tmp/` directory. `/serve/` was used only for API/resource diagnostics; Browser acceptance used formal application routes.

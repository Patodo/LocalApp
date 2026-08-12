---
name: localapp
description: Use when creating, developing, checking, installing, publishing, synchronizing, or Browser-testing an application whose project contains manifest.json and targets a LocalApp Server.
---

# LocalApp application workflow

Treat local and remote deployments as the same Server product. The application owns React/TypeScript, migrations and backend contracts; the Server owns identity, authorization, files, notifications, Issues and operational state.

## Project gate

Confirm `manifest.json`, `package.json`, `migrations/` and `backend/` before editing. If the project does not exist, create it from the installed npm package:

```bash
mkdir -p tmp
cd tmp
localapp init my-app
cd my-app
```

Run those commands from the repository root. Keep generated projects, Server data, uploads and downloads under that repository's `tmp/` during local acceptance; never use the operating-system temp directory.

## Development loop

1. Write the migration and backend contract before UI code that consumes it.
2. Use `localapp dev` and the SDK; do not add an application-private backend.
3. Run application tests and `localapp check --json`.
4. Install with `localapp app install --target <profile>`.
5. Read `ownerId` and `name` from the JSON result, then open `<serverUrl>/<ownerId>/<name>/` with the in-app Browser.
6. Verify DOM, console, core reads/writes and each relevant identity boundary.

`/serve/<owner>/<app>/` is only the raw resource/API base for diagnostics. Never use it as acceptance evidence.

## Supported CLI

| Intent | Command |
| --- | --- |
| Start local daemon | `localapp server` |
| Inspect lifecycle | `localapp server status` / `logs` |
| Run foreground Server | `localapp server run` |
| Save a Server profile | `localapp login <url> --profile <name>` |
| Inspect profile identity | `localapp whoami --profile <name>` |
| Develop | `localapp dev` |
| Check | `localapp check --json` |
| Build portable package | `localapp build --package` |
| Install/update | `localapp app install --target <name>` |
| Sync version | `localapp app sync --target <source> --peer <peer>` |
| Sync version and data | add `--with-data --confirm-app <exact-name>` |
| Refresh managed template | `localapp sync-template` |
| Permanently take ownership | `localapp eject-template` |

For a repository-local acceptance daemon, set `LOCALAPP_SUPPORT_DIR`, `LOCALAPP_RUNTIME_DIR` and `LOCALAPP_DATA_DIR` to absolute subdirectories of the repository `tmp/` before running `localapp server`. Read its `status.server.listenUrl`, complete first-run setup in the Browser, create an API Key, then save that URL and key with `localapp login <url> --api-key <key> --profile local` before using `--target local`.

`app sync --target <source-profile> --peer <server-peer>` asks the Server selected by the CLI profile to synchronize to a peer configured inside that Server. A peer name is not a CLI profile name.

Only top-level `localapp --help` is currently supported. Consult this table or the installed package documentation for subcommand options; do not invent a command from older LocalApp documentation.

## Contracts and security

- Maintain `backend/resources/<resource>/{schema,queries,mutations}.json` directly.
- Parameterize SQL and bind resource ownership to the authenticated user.
- Keep API Keys out of application source, Scheme URLs, logs and Browser state.
- Use SDK content upload/download URLs; never construct storage paths.
- Device Actions execute only on the computer that activates `localapp://`; the URL carries only an opaque ticket.
- Native notifications are Server inbox events delivered by the daemon, not a browser API owned by the application.

## Media applications

For image/PDF flows, use authenticated content upload, store metadata only, provide accessible loading/error/keyboard states, release object URLs, and verify downloaded bytes. Use the template-pinned `react-pdf`, `pdfjs-dist` worker and image lightbox packages.

## Completion contract

Do not claim the application is usable until all are true:

- tests and `localapp check --json` pass;
- installation returns `serverUrl`, `ownerId` and `name`, from which the formal `/<ownerId>/<name>/` URL is formed;
- a fresh in-app Browser tab renders without unexplained console errors;
- core user journeys persist and reload;
- unauthorized and cross-user access fail correctly;
- no credentials, runtime data or machine-external temp paths are packaged.

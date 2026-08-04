# Local Runtime and Optional Publishing

LocalApp supports three separate application workflows:

| Workflow | Purpose | Runtime |
| --- | --- | --- |
| `localapp dev` | Source development and hot reload | Vite plus the development MiniServer |
| `.localapp` plus Desktop | Personal, installed local use | One Desktop-managed MiniServer for multiple apps |
| `localapp upload --profile <name>` | Team or enterprise publishing | The explicitly selected LocalApp Server |

Passing development checks does not install or publish an application. Installing
locally does not upload it. Publishing does not synchronize the application's
local database or files.

## Build and Install Locally

From an application repository:

```bash
localapp check
localapp build --package
localapp local install
```

The package is a deterministic `.localapp` archive containing the application
manifest, migrations, backend contracts, and built static assets. It never
contains the local application database, uploaded files, API keys, or
`manifest.platform.json`.

Desktop installs packages into its managed local application library. A single
MiniServer process serves all active applications through isolated
`<app>.localhost` origins. Each application has independent versions, SQLite
state, files, migrations, Named SQL resources, and failure state. Opening one
application does not start Vite or a second MiniServer.

Installing a newer package is atomic. Desktop retains the previous package so a
failed update can roll back without replacing the application's local data.
Uninstalling removes the installed package but preserves data by default;
deleting local data is a separate explicit action.

## Publish to a Server

Server targets are named profiles:

```bash
localapp server add company --url https://localapp.example.com
localapp server login company
localapp server list
localapp upload --profile company --verify
```

Desktop exposes the same profile model and requires the user to select the
destination before publishing. The publisher checks target capabilities,
registers the application when necessary, and uploads only the package's
portable application content. Credentials remain in the local profile store
and are never sent to the frontend or embedded in the package.

Use local installation for personal tools and offline-capable workflows. Use a
remote Server when the application needs shared identity, collaboration,
central data, platform AI, or access by other users.

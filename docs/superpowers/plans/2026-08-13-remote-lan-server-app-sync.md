# Remote LAN Server and Application Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Install the published LocalApp package on `192.168.2.9`, run its unified Server on the LAN, build and publish a real multi-user application there, then prove app-only and app-with-data synchronization from a separate local Server.

**Architecture:** The remote Ubuntu host and this development Mac run the same `@patodo/localapp@0.1.0` package and the same Server implementation. The remote Server runs in the foreground on `0.0.0.0:49813`; the local source Server uses repository-local state under `tmp/remote-lan-acceptance/` and listens only on loopback. Peer synchronization is source-initiated, uses a target-owned API key, and never copies platform users or permissions.

**Tech Stack:** Node.js 24, npm, `@patodo/localapp@0.1.0`, TypeScript, React, Vite, SQLite migrations, LocalApp Named SQL, SSH, curl, Browser in-app control.

## Global Constraints

- [ ] Keep every local generated project, Server database, upload, download, package, credential file, and acceptance artifact below `/Volumes/patodo-disk/p-github/LocalApp/tmp/remote-lan-acceptance/`; never use system `/tmp`.
- [ ] Keep remote state below `/root/localapp/`; do not modify unrelated files or services on `192.168.2.9`.
- [ ] Use the published `@patodo/localapp@0.1.0`, not a source checkout, on the remote host.
- [ ] Do not introduce systemd, Docker, Tauri, a second backend, or another launcher.
- [ ] Use `browser:control-in-app-browser` for setup, login, application, upload, preview, download, and peer UI acceptance.
- [ ] Treat only `/<owner>/<app>/` URLs returned by Server as formal application acceptance URLs; use `/serve/` only for diagnostics.
- [ ] Store secrets in mode-`0600` files under the acceptance roots and never print API keys or passwords into task output or committed files.
- [ ] Prefix every local CLI command with `LOCALAPP_CONFIG_DIR=/Volumes/patodo-disk/p-github/LocalApp/tmp/remote-lan-acceptance/config` so profiles do not leak into the normal user configuration directory.
- [ ] Stop on any failed assertion, preserve logs/backups, diagnose the failure, and rerun the smallest failing check before continuing.

---

### Task 1: Establish clean local and remote acceptance roots

**Files:**
- Create locally: `tmp/remote-lan-acceptance/README.md`
- Create locally: `tmp/remote-lan-acceptance/evidence/commands.log`
- Create remotely: `/root/localapp/server-data/`
- Create remotely: `/root/localapp/apps/`
- Create remotely: `/root/localapp/logs/`
- Create remotely: `/root/localapp/tmp/`

- [ ] **Step 1: Record the starting state without mutating it**

Run:

```bash
git status --short
ssh root@192.168.2.9 'hostname; uname -a; . /etc/os-release && printf "%s %s\n" "$NAME" "$VERSION_ID"; command -v node || true; command -v npm || true; command -v ufw || true; ss -ltnp | grep ":49813 " || true'
```

Expected: branch remains `main`; host is Ubuntu x86_64; port `49813` is not already occupied. Existing untracked user files in the main repository remain untouched.

- [ ] **Step 2: Create only the approved roots**

Run:

```bash
mkdir -p tmp/remote-lan-acceptance/evidence tmp/remote-lan-acceptance/server-data tmp/remote-lan-acceptance/downloads tmp/remote-lan-acceptance/fixtures tmp/remote-lan-acceptance/apps tmp/remote-lan-acceptance/logs tmp/remote-lan-acceptance/credentials tmp/remote-lan-acceptance/config
chmod 700 tmp/remote-lan-acceptance
ssh root@192.168.2.9 'install -d -m 700 /root/localapp /root/localapp/server-data /root/localapp/apps /root/localapp/logs /root/localapp/tmp'
```

Expected: all roots exist with owner-only access; no application or Server has started.

- [ ] **Step 3: Add an operator note**

Write `tmp/remote-lan-acceptance/README.md` with the remote address, ports, root paths, package version, process stop command, and a warning that the directory contains acceptance credentials. This file is temporary evidence and must remain untracked.

### Task 2: Install the published package and start the remote foreground Server

**Files:**
- Create remotely: `/root/localapp/tmp/nodesource_setup.sh`
- Create remotely: `/root/localapp/logs/server.log`
- Create remotely: `/root/localapp/tmp/server.pid`

- [ ] **Step 1: Install Node.js 24 only if absent or incompatible**

Run remotely after downloading the installer to the approved temporary root:

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x -o /root/localapp/tmp/nodesource_setup.sh
bash /root/localapp/tmp/nodesource_setup.sh 2>&1 | tee /root/localapp/logs/install.log
apt-get install -y nodejs 2>&1 | tee -a /root/localapp/logs/install.log
node --version
npm --version
```

Expected: `node --version` starts with `v24.` and npm is available. Preserve the installer and apt output in `/root/localapp/logs/install.log` for diagnosis.

- [ ] **Step 2: Install and verify the exact released LocalApp package**

Run:

```bash
npm install --global @patodo/localapp@0.1.0
localapp --version
npm view @patodo/localapp@0.1.0 dist.integrity
```

Expected: CLI reports `0.1.0`; npm resolves the same released version.

- [ ] **Step 3: Restrict the firewall change to the LAN when UFW is active**

Run:

```bash
ufw status
```

If and only if the first line reports `Status: active`, run:

```bash
ufw allow from 192.168.2.0/24 to any port 49813 proto tcp comment 'LocalApp LAN acceptance'
ufw status numbered
```

Expected: active UFW permits only the local `/24` to TCP `49813`; inactive UFW remains unchanged.

- [ ] **Step 4: Start the unified Server in a retained foreground SSH PTY**

Start one long-lived terminal session with:

```bash
ssh -tt root@192.168.2.9 'printf "%s\n" "$$" > /root/localapp/tmp/server.pid; exec localapp server run --data-dir /root/localapp/server-data --host 0.0.0.0 --port 49813 2>&1 | tee -a /root/localapp/logs/server.log'
```

Expected: the terminal remains attached and shows the ready/setup URL. Do not background or daemonize this process.

- [ ] **Step 5: Prove process and LAN reachability independently**

Run from a second terminal:

```bash
ssh root@192.168.2.9 'ss -ltnp | grep ":49813 "'
curl --fail --show-error --silent --dump-header tmp/remote-lan-acceptance/evidence/remote-root.headers http://192.168.2.9:49813/ -o tmp/remote-lan-acceptance/evidence/remote-root.html
curl --fail --show-error --silent http://192.168.2.9:49813/health
curl --show-error --silent --output tmp/remote-lan-acceptance/evidence/remote-setup.html --write-out '%{http_code}\n' http://192.168.2.9:49813/setup
```

Expected: listener is `0.0.0.0:49813`; `/health` returns `{"status":"ok"}`; the root and `/setup` return a LocalApp setup/login response rather than a connection error.

### Task 3: Initialize the remote Server and create target credentials

**Files:**
- Create locally: `tmp/remote-lan-acceptance/credentials/remote-admin.txt`
- Create locally: `tmp/remote-lan-acceptance/credentials/remote-api-key.txt`
- Create remotely: `/root/localapp/tmp/remote-api-key.txt`
- Create remotely: `/root/localapp/tmp/config/profiles.json`
- Update remotely: `/root/localapp/server-data/`

- [ ] **Step 1: Open an SSH tunnel for loopback-only first setup**

Run in a retained terminal:

```bash
ssh -N -L 49813:127.0.0.1:49813 root@192.168.2.9
```

Expected: `http://127.0.0.1:49813/` reaches the remote Server while first-admin setup remains loopback-scoped.

- [ ] **Step 2: Initialize the first administrator through Browser**

Use the one-time setup URL from the foreground Server log. Create a unique remote admin account, save its generated password under `tmp/remote-lan-acceptance/credentials/remote-admin.txt`, log in, and confirm `/my` loads.

Expected: setup token is consumed, subsequent setup requests are rejected, and the dashboard identifies the remote account as administrator.

- [ ] **Step 3: Confirm LAN access remains explicit and enabled**

In the remote Web system settings, verify listener host `0.0.0.0`, port `49813`, and LAN access enabled. Save a Browser screenshot to `tmp/remote-lan-acceptance/evidence/remote-network.png` without exposing secrets.

Expected: `http://192.168.2.9:49813/my` redirects to login when unauthenticated and loads after remote login.

- [ ] **Step 4: Create a target-owned synchronization API key**

In Web, create an API key named `local-source-acceptance`, copy it once into `tmp/remote-lan-acceptance/credentials/remote-api-key.txt`, and set file mode `0600`.

Expected: the API key belongs to the remote admin and is accepted by:

```bash
LOCALAPP_CONFIG_DIR=/Volumes/patodo-disk/p-github/LocalApp/tmp/remote-lan-acceptance/config npx --yes --package @patodo/localapp@0.1.0 localapp login http://192.168.2.9:49813 --profile remote-acceptance --api-key "$(<tmp/remote-lan-acceptance/credentials/remote-api-key.txt)"
LOCALAPP_CONFIG_DIR=/Volumes/patodo-disk/p-github/LocalApp/tmp/remote-lan-acceptance/config npx --yes --package @patodo/localapp@0.1.0 localapp whoami --profile remote-acceptance
```

The command output identifies the remote admin without printing the key.

- [ ] **Step 5: Create a repository-local remote-host profile for publishing the remote-built app**

Transfer the key from the local repository without writing its value to shell history or command output:

```bash
scp tmp/remote-lan-acceptance/credentials/remote-api-key.txt root@192.168.2.9:/root/localapp/tmp/remote-api-key.txt
ssh root@192.168.2.9 'chmod 600 /root/localapp/tmp/remote-api-key.txt'
```

Then run remotely:

```bash
install -d -m 700 /root/localapp/tmp/config
LOCALAPP_CONFIG_DIR=/root/localapp/tmp/config localapp login http://127.0.0.1:49813 --profile remote-self --api-key "$(</root/localapp/tmp/remote-api-key.txt)"
LOCALAPP_CONFIG_DIR=/root/localapp/tmp/config localapp whoami --profile remote-self
```

Expected: the profile belongs to the remote administrator and neither command prints the key.

### Task 4: Generate a failing contract test for `device-notes`

**Files:**
- Create remotely: `/root/localapp/apps/device-notes/`
- Create remotely: `/root/localapp/apps/device-notes/tests/device-notes-contract.test.ts`
- Modify remotely: `/root/localapp/apps/device-notes/package.json`

- [ ] **Step 1: Generate from the released builtin template**

Run remotely:

```bash
cd /root/localapp/apps
localapp init device-notes --skip-deploy
cd device-notes
git init
git config user.name 'LocalApp Acceptance'
git config user.email 'localapp-acceptance@localhost'
git add .
git commit -m 'chore: initialize LocalApp device notes application'
```

Expected: generated project includes `AGENTS.md`, app development skills, migrations, Named SQL, SDK runtime, tests, and a React UI.

- [ ] **Step 2: Read generated development instructions before editing**

Read the complete generated `AGENTS.md` and the LocalApp data/UI skills it references. Record any generated command differences in the remote git commit notes; generated instructions override command assumptions in this plan.

- [ ] **Step 3: Write the application contract test first**

Add `tests/device-notes-contract.test.ts` asserting:

- manifest name is exactly `device-notes`;
- migration creates `device_notes` with `id`, `title`, `device`, `content`, `status`, `created_by`, `created_at`, and `updated_at`;
- status accepts only `open` or `done`;
- Named SQL exposes list/search/filter/get/create/update/mark-done/reopen/delete;
- all business operations require authentication;
- list/get/update/state/delete SQL uses `(:currentUserId = :ownerId OR created_by = :currentUserId)`;
- create writes `:currentUserId` into `created_by`;
- custom security metadata declares exact `currentUserId` and `ownerId` system params and owner/member scenarios;
- the UI calls only declared Named SQL and renders empty, loading, failure, and successful CRUD states.

- [ ] **Step 4: Run the focused test and observe RED**

Run the generated test command targeting `tests/device-notes-contract.test.ts`.

Expected: failure because the generated work-item schema and UI do not implement device notes. A test that passes before implementation must be strengthened.

- [ ] **Step 5: Commit the red test**

Run remotely:

```bash
git add package.json tests/device-notes-contract.test.ts
git commit -m 'test: define device notes data and ownership contract'
```

### Task 5: Implement and install `device-notes`

**Files:**
- Modify remotely: `/root/localapp/apps/device-notes/manifest.json`
- Create remotely: `/root/localapp/apps/device-notes/migrations/001_device_notes.sql`
- Create remotely: `/root/localapp/apps/device-notes/backend/resources/device_notes/schema.json`
- Create remotely: `/root/localapp/apps/device-notes/backend/resources/device_notes/queries.json`
- Create remotely: `/root/localapp/apps/device-notes/backend/resources/device_notes/mutations.json`
- Modify remotely: `/root/localapp/apps/device-notes/src/App.tsx`
- Modify remotely: `/root/localapp/apps/device-notes/src/index.css`
- Modify remotely: `/root/localapp/apps/device-notes/tests/device-notes-contract.test.ts`
- Remove remotely: generated work-item migration/resource files after replacement

- [ ] **Step 1: Implement the migration and Named SQL contract**

Use custom security for owner-aware operations with:

```json
{
  "mode": "custom",
  "access": "authenticated",
  "resources": ["device_notes"],
  "systemParams": ["currentUserId", "ownerId"],
  "scenarios": [
    { "identity": "owner", "expect": "allow" },
    { "identity": "member", "expect": "allow" }
  ]
}
```

Every read/update/delete predicate must additionally enforce `(:currentUserId = :ownerId OR created_by = :currentUserId)`. Creation always records `created_by = :currentUserId`; no client-supplied owner field is accepted. Use `:now` for timestamps only if declared in `systemParams` for that statement.

Expected: app owner can query all records; members can query or mutate only their own records; anonymous callers are denied by runtime access.

- [ ] **Step 2: Implement the responsive React experience**

Build a single-page notes manager with create/edit/delete, open/done transitions, free-text search across title/device/content, status filter, creator/timestamp metadata, and explicit empty/loading/error states. Preserve the LocalApp Platform Shell and SDK usage generated by the template.

- [ ] **Step 3: Make the focused test GREEN**

Run the generated focused test command, then:

```bash
npm test
npm run build
LOCALAPP_CONFIG_DIR=/root/localapp/tmp/config localapp check --json --profile remote-self
```

Expected: all tests/build/check pass; check reports no contract, migration, SDK, or access-policy errors.

- [ ] **Step 4: Install into the remote Server**

Run:

```bash
LOCALAPP_CONFIG_DIR=/root/localapp/tmp/config localapp app install --target remote-self
```

Expected: response identifies application `device-notes`, its first installed version, remote owner, and a formal URL under `http://192.168.2.9:49813/<owner>/device-notes/`.

- [ ] **Step 5: Commit the green application**

Run remotely:

```bash
git add -A
git commit -m 'feat: implement multi-user device notes application'
```

### Task 6: Browser-verify remote multi-user behavior

**Files:**
- Create locally: `tmp/remote-lan-acceptance/evidence/device-notes-owner.png`
- Create locally: `tmp/remote-lan-acceptance/evidence/device-notes-member.png`
- Create locally: `tmp/remote-lan-acceptance/evidence/device-notes-console.txt`

- [ ] **Step 1: Verify owner CRUD and filters**

Open the formal remote URL in Browser as the remote administrator/application owner. Create two notes with different devices and statuses; edit one, mark one done, reopen it, search by device/content, filter by status, and delete one.

Expected: every state change persists after reload; search/filter results are exact; page has no uncaught console errors or failed same-origin API requests.

- [ ] **Step 2: Create and log in as an ordinary user**

Use remote user management to create a member account. Log out, log in as that member, open the same formal URL, and create a third note.

Expected: member sees and manages only the third note and cannot retrieve or mutate either owner note even by replaying an observed record ID through the app API.

- [ ] **Step 3: Reconfirm owner visibility**

Log back in as application owner.

Expected: owner sees both its remaining note and the member note and can change the member note. Save screenshots and sanitized console evidence.

### Task 7: Start an independent local source Server and install fixtures

**Files:**
- Update locally: `tmp/remote-lan-acceptance/server-data/`
- Create locally: `tmp/remote-lan-acceptance/apps/skill-market/`
- Create locally: `tmp/remote-lan-acceptance/apps/resume-manager/`
- Create locally: `tmp/remote-lan-acceptance/credentials/local-admin.txt`
- Create locally: `tmp/remote-lan-acceptance/credentials/local-api-key.txt`
- Create locally: `tmp/remote-lan-acceptance/logs/local-server.log`

- [ ] **Step 1: Start the published package against repository-local state**

Start a retained foreground terminal from the repository root:

```bash
npx --yes --package @patodo/localapp@0.1.0 localapp server run --data-dir /Volumes/patodo-disk/p-github/LocalApp/tmp/remote-lan-acceptance/server-data --host 127.0.0.1 --port 49814 2>&1 | tee /Volumes/patodo-disk/p-github/LocalApp/tmp/remote-lan-acceptance/logs/local-server.log
```

Expected: a separate clean Server is ready on `http://127.0.0.1:49814`; it does not share databases, users, uploads, or credentials with the remote Server.

- [ ] **Step 2: Initialize local admin and profile**

Use Browser and the one-time local setup URL to create a distinct local admin. Create a `local-source-acceptance` API key, save credentials as `0600`, and run:

```bash
LOCALAPP_CONFIG_DIR=/Volumes/patodo-disk/p-github/LocalApp/tmp/remote-lan-acceptance/config npx --yes --package @patodo/localapp@0.1.0 localapp login http://127.0.0.1:49814 --profile local-source --api-key "$(<tmp/remote-lan-acceptance/credentials/local-api-key.txt)"
LOCALAPP_CONFIG_DIR=/Volumes/patodo-disk/p-github/LocalApp/tmp/remote-lan-acceptance/config npx --yes --package @patodo/localapp@0.1.0 localapp whoami --profile local-source
```

Expected: local identity differs from remote identity.

- [ ] **Step 3: Copy both examples into the isolated acceptance root**

Run from the repository root:

```bash
rsync -a --delete --exclude node_modules --exclude dist --exclude tmp --exclude .claude examples/skill-market/ tmp/remote-lan-acceptance/apps/skill-market/
rsync -a --delete --exclude node_modules --exclude dist --exclude tmp --exclude .claude examples/resume-manager/ tmp/remote-lan-acceptance/apps/resume-manager/
```

Expected: the copies contain only tracked application source and do not mutate either repository example or its user-owned `.claude/` directory.

- [ ] **Step 4: Build, check, and install both isolated example copies**

Run from each example directory using the published CLI:

```bash
LOCALAPP_CONFIG_DIR=/Volumes/patodo-disk/p-github/LocalApp/tmp/remote-lan-acceptance/config npx --yes --package @patodo/localapp@0.1.0 localapp check --json --profile local-source
LOCALAPP_CONFIG_DIR=/Volumes/patodo-disk/p-github/LocalApp/tmp/remote-lan-acceptance/config npx --yes --package @patodo/localapp@0.1.0 localapp app install --target local-source
```

Apply from `tmp/remote-lan-acceptance/apps/skill-market` and `tmp/remote-lan-acceptance/apps/resume-manager`.

Expected: both install successfully and return formal URLs on port `49814`; Browser opens each with no blank page or console failure.

### Task 8: Configure the remote peer and prove app-only synchronization

**Files:**
- Update locally: `tmp/remote-lan-acceptance/server-data/`
- Create locally: `tmp/remote-lan-acceptance/evidence/skill-market-sync.json`

- [ ] **Step 1: Configure the target through the local Server Web UI**

Open `http://127.0.0.1:49814/my/peers` in Browser. Add peer `remote-lan` with URL `http://192.168.2.9:49813`, the remote target API key, and the explicit insecure-private-LAN acknowledgement.

Expected: capability check succeeds, peer displays the verified remote user ID/name and protocol version, and the API key is not displayed after saving.

- [ ] **Step 2: Push `skill-market` without data**

Run from `tmp/remote-lan-acceptance/apps/skill-market`:

```bash
LOCALAPP_CONFIG_DIR=/Volumes/patodo-disk/p-github/LocalApp/tmp/remote-lan-acceptance/config npx --yes --package @patodo/localapp@0.1.0 localapp app sync --target local-source --peer remote-lan
```

Expected: target creates `skill-market` or installs a new version with unchanged app name; target application owner is the user represented by the target API key.

- [ ] **Step 3: Verify package-only semantics**

Open the remote formal `skill-market` URL in Browser and exercise its normal browse flow without executing a machine action.

Expected: application works remotely; target users, sessions, peer definitions, and unrelated app data are unchanged. Record the sanitized sync response and remote version in evidence.

### Task 9: Seed file fixtures and prove transactional app-with-data synchronization

**Files:**
- Create locally: `tmp/remote-lan-acceptance/fixtures/acceptance.pdf`
- Create locally: `tmp/remote-lan-acceptance/fixtures/acceptance.png`
- Create locally: `tmp/remote-lan-acceptance/evidence/fixture-sha256.txt`
- Create locally: `tmp/remote-lan-acceptance/downloads/`

- [ ] **Step 1: Generate deterministic PDF and PNG fixtures inside the repository**

Create a one-page PDF and small PNG with unique visible acceptance text. If a Python helper is needed, execute it with `uv run`, never bare `python`. Record SHA-256 and MIME type for each fixture.

Expected: PDF opens locally as a valid one-page document; PNG dimensions and pixels are valid; neither fixture contains secrets.

- [ ] **Step 2: Seed source `resume-manager` through its formal UI**

In Browser, open the local formal resume-manager URL, upload the PDF and image through supported UI flows, create the corresponding records, verify inline previews, then download both files into `tmp/remote-lan-acceptance/downloads/source/`.

Expected: downloaded source bytes match fixture SHA-256 exactly and content types are `application/pdf` and `image/png`.

- [ ] **Step 3: Create divergent target state before replacement**

If `resume-manager` does not yet exist remotely, first app-only sync it. In the remote formal UI, create one unmistakable target-only record/file.

Expected: target-only state is visible before data sync, proving the next operation performs replacement rather than merge.

- [ ] **Step 4: Synchronize application and data with exact confirmation**

Run from `tmp/remote-lan-acceptance/apps/resume-manager`:

```bash
LOCALAPP_CONFIG_DIR=/Volumes/patodo-disk/p-github/LocalApp/tmp/remote-lan-acceptance/config npx --yes --package @patodo/localapp@0.1.0 localapp app sync --target local-source --peer remote-lan --with-data --confirm-app resume-manager
```

Expected: target first creates a consistency backup, installs/updates the package, atomically replaces that application's database and files, and reports success. Preserve the backup identifier from the response.

- [ ] **Step 5: Verify remote data, previews, and byte identity**

Open the remote formal resume-manager URL in Browser. Confirm the source records are present, the target-only record is absent, PDF/image previews render, and downloads saved under `tmp/remote-lan-acceptance/downloads/remote/` match original SHA-256 values byte-for-byte.

Expected: application and application data match source; Server users, sessions, roles, API keys, peer definitions, and other applications still belong to the target and were not replaced.

### Task 10: Prove restart persistence and collect final evidence

**Files:**
- Create locally: `tmp/remote-lan-acceptance/evidence/final-report.md`
- Update remotely: `/root/localapp/logs/server.log`

- [ ] **Step 1: Stop only the known remote foreground process**

Send `Ctrl-C` to the retained remote Server PTY. Do not use a broad `pkill` pattern.

Expected: the listener on `49813` disappears and the foreground log shows a clean shutdown.

- [ ] **Step 2: Restart the exact same Server and data directory**

Run again in a retained terminal:

```bash
ssh -tt root@192.168.2.9 'printf "%s\n" "$$" > /root/localapp/tmp/server.pid; exec localapp server run --data-dir /root/localapp/server-data --host 0.0.0.0 --port 49813 2>&1 | tee -a /root/localapp/logs/server.log'
```

Expected: Server becomes reachable without setup; all three remote applications, users, permissions, synchronized resume records, and uploaded files persist.

- [ ] **Step 3: Run the final Browser smoke suite**

Verify formal remote URLs for `device-notes`, `skill-market`, and `resume-manager`; inspect console and failed network requests; repeat one read/write action in device-notes and both remote file downloads.

Expected: all formal pages render, no blank screens, authenticated operations work, permission boundaries remain enforced, and fixture digests still match.

- [ ] **Step 4: Write a sanitized final report**

Record package version, host/port, app/version IDs, formal URLs, test commands, HTTP results, Browser assertions, sync backup ID, download digests, restart result, and remaining operational caveats in `tmp/remote-lan-acceptance/evidence/final-report.md`. Do not include passwords, API keys, setup tokens, cookies, or raw credential-bearing URLs.

- [ ] **Step 5: Verify repository hygiene**

Run:

```bash
git status --short
git diff --check
```

Expected: acceptance state remains untracked below the approved `tmp/` root (normally ignored); pre-existing user-owned untracked files are unchanged; only intentional documentation commits exist in the main repository.

## Completion Criteria

- [ ] `@patodo/localapp@0.1.0` runs the remote unified Server in foreground mode on `192.168.2.9:49813` and emits usable logs.
- [ ] `device-notes` is generated from the published package, passes tests/check/build, is installed remotely, and enforces owner-versus-member data isolation.
- [ ] Remote `skill-market` works after app-only peer sync.
- [ ] Remote `resume-manager` works after app-with-data sync, including PDF/image preview and byte-identical downloads.
- [ ] The target backup is created before data replacement, and target platform users/permissions remain independent.
- [ ] Remote stop/restart preserves applications, databases, uploads, users, permissions, and API credentials.
- [ ] Browser console/network evidence and a sanitized final report are present under the repository-local acceptance root.

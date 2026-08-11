# Local Windows Release

This guide is for an operator producing LocalApp Windows x64 artifacts from a
Windows workstation. The repository-root script is the source of truth for the
build interface:

```powershell
.\scripts\build-windows-release.ps1 [-Target All|Cli|Desktop] [-Mode Test|Release] [-OutputDirectory <path>] [-SkipInstall]
```

The default target is `All`, the default mode is `Test`, and the default output
directory is `dist/windows` relative to the repository root. The script only
supports an AMD64/x86_64 Windows host and a 64-bit AMD64/x86_64 PowerShell
process. It rejects ARM64 before installation or build work begins.

## Prerequisites

Install these tools before starting:

- Windows 10/11 x64
- PowerShell 5.1 or PowerShell 7, running as a 64-bit process
- Git
- Node.js 24.x
- pnpm 10.x
- Rust stable with the `x86_64-pc-windows-msvc` target
- Visual Studio 2022 Build Tools with **Desktop development with C++**

From a fresh checkout, run the following in PowerShell at the repository root:

```powershell
corepack enable
pnpm install --frozen-lockfile
```

The build script checks that `git`, `node`, `pnpm`, `cargo`, and `rustc` are on
`PATH`, and that Node.js is 24.x and pnpm is 10.x. It does not install tools
globally or delete source or build directories.

## Test Build

Use Test mode to produce unsigned local artifacts and exercise the complete
CLI/Desktop packaging path:

```powershell
.\scripts\build-windows-release.ps1 -Target All -Mode Test -SkipInstall
```

The optional tray bridge installer must contain the pinned Node runtime, the
canonical Server entrypoint, and SQLite WASM. Validate those source resources
before building:

```powershell
pnpm --filter @localapp/desktop test:bundle
```

Use `-Target Cli` or `-Target Desktop` to build only one artifact family. Use
`-OutputDirectory` to select a directory outside the repository sources, for
example:

```powershell
.\scripts\build-windows-release.ps1 `
  -Target Desktop `
  -Mode Test `
  -SkipInstall `
  -OutputDirectory "$env:TEMP\localapp-windows-test"
```

Choose a new or empty output directory for every invocation. The script rejects
a non-empty directory instead of mixing a new build with existing files, and
does not recursively remove it. It also rejects output roots, ancestors, and
the selected `cli\`/`desktop\` directories when any is a junction, symlink, or
other reparse point.

The output contains only the selected artifacts under `cli\` and/or
`desktop\`, plus `manifest.json` and `SHA256SUMS.txt`. The CLI is collected from
the versioned `packages\server\static\cli\<Cargo version>\` release location,
not from Cargo's raw target directory. Test mode writes an explicit temporary
Tauri merge config with updater artifact creation disabled. It does not create
an updater signature and must not be described or published as a Release build.
When Authenticode thumbprint/timestamp variables are set, Test mode validates
and applies the same public Windows signing metadata as Release mode without
requiring updater secrets.

## Release Build and Signing

Release mode requires these three environment variables. Set them only in the
current PowerShell session from an approved secret store; do not commit real
values or paste private keys into this document:

```powershell
$env:LOCALAPP_UPDATER_ENDPOINT = "https://updates.example.test/windows/{{target}}/{{arch}}/{{current_version}}"
$env:LOCALAPP_UPDATER_PUBKEY = "<public-updater-key-from-secret-store>"
$env:TAURI_SIGNING_PRIVATE_KEY = "<private-updater-key-from-secret-store>"

.\scripts\build-windows-release.ps1 `
  -Target All `
  -Mode Release `
  -SkipInstall `
  -OutputDirectory ".\dist\windows-release"
```

The endpoint must use HTTPS. Release mode fails closed if any of the three
variables is missing, and the Desktop output must contain a fresh updater
signature beside the NSIS installer (`.exe.sig`). Keep the private key in the
process environment only for as long as the build requires it, then clear the
session values:

```powershell
Remove-Item Env:LOCALAPP_UPDATER_ENDPOINT, Env:LOCALAPP_UPDATER_PUBKEY, Env:TAURI_SIGNING_PRIVATE_KEY
```

Authenticode is optional at the build-script level. For a trusted installer
distributed publicly, configure an Authenticode certificate before publishing.
The release config accepts `LOCALAPP_WINDOWS_CERTIFICATE_THUMBPRINT` and, only
with that thumbprint, the optional HTTPS
`LOCALAPP_WINDOWS_TIMESTAMP_URL`. The local script does not manage certificate
import or private certificate material; use the machine or signing setup
approved for the release environment.

## Verify Checksums

Verify the entire release directory before upload. This PowerShell 5.1-compatible
check requires every manifest artifact to exist, requires exactly one matching
`SHA256SUMS.txt` entry per artifact, compares both declared hashes, rejects
links and unexpected files/directories, and prepares the only files eligible
for upload.

```powershell
function Assert-NoReparsePointPath([string]$Path) {
  $directory = New-Object IO.DirectoryInfo ([IO.Path]::GetFullPath($Path))
  while ($null -ne $directory) {
    if (Test-Path -LiteralPath $directory.FullName) {
      $item = Get-Item -LiteralPath $directory.FullName -Force
      if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "Release output path contains a reparse point: $($item.FullName)"
      }
    }
    $directory = $directory.Parent
  }
}

$release = [IO.Path]::GetFullPath((Join-Path (Join-Path (Get-Location).Path "dist") "windows-release"))
if (!(Test-Path -LiteralPath $release -PathType Container)) {
  throw "Release output directory was not found: $release"
}
Assert-NoReparsePointPath $release
$release = (Get-Item -LiteralPath $release -Force).FullName
$manifestPath = Join-Path $release "manifest.json"
$checksumsPath = Join-Path $release "SHA256SUMS.txt"
if (!(Test-Path -LiteralPath $manifestPath -PathType Leaf) -or
    !(Test-Path -LiteralPath $checksumsPath -PathType Leaf)) {
  throw "manifest.json and SHA256SUMS.txt are both required"
}

$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
foreach ($field in @("gitCommit", "toolchain", "target", "mode", "generatedAt", "updaterSignature", "artifacts")) {
  if ($null -eq $manifest.PSObject.Properties[$field]) {
    throw "manifest.json is missing $field"
  }
}
if ($manifest.gitCommit -notmatch "^[0-9a-fA-F]{40}$" -or
    [string]::IsNullOrWhiteSpace([string]$manifest.toolchain.node) -or
    [string]::IsNullOrWhiteSpace([string]$manifest.toolchain.pnpm) -or
    [string]::IsNullOrWhiteSpace([string]$manifest.toolchain.rustc)) {
  throw "manifest.json build provenance is incomplete"
}

$checksums = @{}
foreach ($line in @(Get-Content -LiteralPath $checksumsPath)) {
  $match = [regex]::Match($line, "^([a-fA-F0-9]{64}) \*(.+)$")
  if (!$match.Success) { throw "Invalid SHA256SUMS.txt entry: $line" }
  $relativePath = $match.Groups[2].Value
  if ($checksums.ContainsKey($relativePath)) {
    throw "SHA256SUMS.txt repeats $relativePath"
  }
  $checksums[$relativePath] = $match.Groups[1].Value.ToLowerInvariant()
}

$expectedFiles = @{
  "manifest.json" = $manifestPath
  "SHA256SUMS.txt" = $checksumsPath
}
$expectedDirectories = @{}
$uploadFiles = @(
  [pscustomobject]@{ RelativePath = "manifest.json"; FullName = $manifestPath }
  [pscustomobject]@{ RelativePath = "SHA256SUMS.txt"; FullName = $checksumsPath }
)
if (@($manifest.artifacts).Count -eq 0) {
  throw "manifest.json must declare at least one artifact"
}
foreach ($artifact in @($manifest.artifacts)) {
  $relativePath = [string]$artifact.path
  if ($relativePath -notmatch "^(cli|desktop)/[^/\\]+$") {
    throw "manifest.json contains an invalid artifact path: $relativePath"
  }
  if ($expectedFiles.ContainsKey($relativePath)) {
    throw "manifest.json repeats $relativePath"
  }
  if ([int64]$artifact.bytes -lt 1 -or [string]$artifact.sha256 -notmatch "^[a-fA-F0-9]{64}$") {
    throw "manifest.json has an incomplete artifact record for $relativePath"
  }
  if (!$checksums.ContainsKey($relativePath)) {
    throw "SHA256SUMS.txt is missing $relativePath"
  }
  if ($checksums[$relativePath] -ne ([string]$artifact.sha256).ToLowerInvariant()) {
    throw "manifest.json and SHA256SUMS.txt disagree for $relativePath"
  }
  $fullPath = Join-Path $release ($relativePath.Replace('/', '\'))
  if (!(Test-Path -LiteralPath $fullPath -PathType Leaf)) {
    throw "Manifest artifact is missing: $relativePath"
  }
  $actual = (Get-FileHash -LiteralPath $fullPath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $checksums[$relativePath]) {
    throw "SHA-256 mismatch for ${relativePath}: expected $($checksums[$relativePath]), got $actual"
  }
  $expectedFiles[$relativePath] = $fullPath
  $expectedDirectories[$relativePath.Split("/")[0]] = $true
  $uploadFiles += [pscustomobject]@{ RelativePath = $relativePath; FullName = $fullPath }
}
if ($checksums.Count -ne (@($manifest.artifacts)).Count) {
  throw "SHA256SUMS.txt has entries not declared by manifest.json"
}
if ($manifest.mode -eq "Release" -and $expectedDirectories.ContainsKey("desktop") -and !$manifest.updaterSignature) {
  throw "Release Desktop manifest must declare an updater signature"
}
if ($manifest.mode -eq "Release" -and $expectedDirectories.ContainsKey("desktop")) {
  $installers = @($manifest.artifacts | Where-Object { $_.path -match "^desktop/.+\.exe$" })
  $signatures = @($manifest.artifacts | Where-Object { $_.path -match "^desktop/.+\.exe\.sig$" })
  if ($installers.Count -ne 1 -or $signatures.Count -ne 1 -or
      $signatures[0].path -ne "$($installers[0].path).sig") {
    throw "Release Desktop manifest must contain one installer and its current signature"
  }
}

$seenFiles = @{}
$directoriesToScan = New-Object System.Collections.Queue
$directoriesToScan.Enqueue($release)
while ($directoriesToScan.Count -gt 0) {
  $directory = [string]$directoriesToScan.Dequeue()
  foreach ($item in @(Get-ChildItem -LiteralPath $directory -Force)) {
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw "Release output contains a reparse point: $($item.FullName)"
    }
    $relativePath = $item.FullName.Substring($release.Length).TrimStart([char[]]@('\', '/')).Replace('\', '/')
    if ($item.PSIsContainer) {
      if (!$expectedDirectories.ContainsKey($relativePath)) {
        throw "Release output contains an unexpected directory: $relativePath"
      }
      $directoriesToScan.Enqueue($item.FullName)
      continue
    }
    if (!$expectedFiles.ContainsKey($relativePath)) {
      throw "Release output contains an unexpected file: $relativePath"
    }
    $seenFiles[$relativePath] = $true
  }
}
if ($seenFiles.Count -ne $expectedFiles.Count) {
  throw "Release output is missing a manifest/checksum file"
}
Write-Host "Verified $($checksums.Count) artifacts and prepared the explicit upload list."
```

Do not upload when this verification fails. The generated `manifest.json` also
records the Git commit, Node/pnpm/rustc versions, mode/target, UTC generation
time, updater-signature flag, and each artifact's path, bytes, and SHA-256.

## Upload

The receiving SSH service uses port `55666`. Upload each build into an isolated
release directory. Run these PowerShell 5.1-compatible commands in the same
session immediately after the verification block, so they use its validated
`$uploadFiles` list rather than enumerating the release directory again. They
use UTC time, the current git short commit, and a complete GUID to create a
collision-resistant `releaseId`:

```powershell
$release = (Resolve-Path ".\dist\windows-release").Path
$utc = (Get-Date).ToUniversalTime().ToString("yyyyMMdd'T'HHmmss'Z'", [Globalization.CultureInfo]::InvariantCulture)
$gitShortCommit = ((& git rev-parse --short HEAD 2>$null) -join "").Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($gitShortCommit)) {
  throw "Unable to determine the current git short commit"
}
if ($gitShortCommit -notmatch "^[0-9a-fA-F]+$") {
  throw "git short commit contains unexpected characters"
}
$guid = [guid]::NewGuid().ToString("N")
$releaseId = "{0}-{1}-{2}" -f $utc, $gitShortCommit, $guid
$remote = "root@127.0.0.1"
$remoteRelease = "/pjg/localapp/releases/windows/$releaseId"
$artifactDirectories = @($uploadFiles | ForEach-Object {
  if ($_.RelativePath -match "^(cli|desktop)/") { $Matches[1] }
} | Select-Object -Unique)
$mkdirArtifacts = @($artifactDirectories | ForEach-Object { "mkdir releases/windows/$releaseId/$_" }) -join " && "
$mkdirCommand = "cd /pjg/localapp && mkdir -p releases/windows && mkdir releases/windows/$releaseId"
if ($mkdirArtifacts) { $mkdirCommand = "$mkdirCommand && $mkdirArtifacts" }

ssh -p 55666 $remote $mkdirCommand
if ($LASTEXITCODE -ne 0) {
  throw "Unable to create the isolated remote release directory: $remoteRelease"
}

foreach ($uploadFile in $uploadFiles) {
  $remoteDirectory = if ($uploadFile.RelativePath -match "^(cli|desktop)/") {
    "$remoteRelease/$($Matches[1])/"
  } else {
    "$remoteRelease/"
  }
  scp -P 55666 $uploadFile.FullName "${remote}:$remoteDirectory"
  if ($LASTEXITCODE -ne 0) {
    throw "Unable to upload $($uploadFile.RelativePath) to $remoteRelease"
  }
}
Write-Host "Uploaded release $releaseId to $remoteRelease/"
```

`ToUniversalTime()`, the explicit invariant format, and
`[guid]::NewGuid().ToString("N")` work in Windows PowerShell 5.1 as well as
PowerShell 7. SSH uses lowercase `-p`; `scp` uses uppercase `-P` for the same
port. The remote commands above only ensure the shared release root exists and
create/write `/pjg/localapp/releases/windows/$releaseId/`. They do not access
or modify other remote directories, and they never delete anything.

The per-release directory prevents one upload from overwriting another and
keeps an earlier release available for rollback by selecting its existing
`releaseId`. The second remote `mkdir` intentionally does not use `-p`: if a
target directory already exists, the SSH command fails and the release must be
retried with a newly generated `releaseId`; it must never be reused or
overwritten. The upload loop sends only `manifest.json`, `SHA256SUMS.txt`, and
the files declared by the validated manifest; it does not use a wildcard. Do
not replace `$remoteRelease` with the shared `/pjg/localapp/releases/windows/`
directory and do not add a remote delete command.

## Clean VM Acceptance

A successful local build, checksum check, or macOS/Linux test is not evidence
that Windows installation is accepted. Clean-VM acceptance remains mandatory
before distributing the installer publicly or closing the Windows release task.

Use a clean Windows x64 VM with a non-administrator user, no system Node.js or
`npm` on `PATH`, and no preinstalled WebView2 Runtime when that precondition is
being tested. Copy the current installer, its SHA-256, the optional previous
installer and hash, and `packages/desktop/scripts/windows-vm-acceptance.ps1` to
the VM. Run the existing harness from the VM:

```powershell
powershell -ExecutionPolicy Bypass `
  -File C:\acceptance\windows-vm-acceptance.ps1 `
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

The report must record the required automated and interactive checks. An
automation-only report with manual checks marked `not-run` is not sufficient
to complete acceptance. Validate the report with
`packages/desktop/scripts/windows-vm-acceptance-report.mjs` from a development
checkout before treating the release as accepted.

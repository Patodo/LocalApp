import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptUrl = new URL("./build-windows-release.ps1", import.meta.url);
const source = await readFile(scriptUrl, "utf8");
const releaseGuide = await readFile(
  new URL("../docs/windows-local-release.md", import.meta.url),
  "utf8",
);
const desktopReadme = await readFile(
  new URL("../packages/desktop/README.md", import.meta.url),
  "utf8",
);
const releaseDesign = await readFile(
  new URL("../docs/superpowers/specs/2026-07-24-windows-local-release-script-design.md", import.meta.url),
  "utf8",
);
const uploadVerificationScript = extractPowerShellBlock(releaseGuide, "## Verify Checksums");
const powerShellCommands = findPowerShellCommands();

function findPowerShellCommands() {
  return ["powershell", "pwsh"].filter((command) => {
    const result = spawnSync(command, ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.Major"], {
      encoding: "utf8",
    });
    return result.status === 0;
  });
}

function quotePowerShell(value) {
  return value.replace(/'/g, "''");
}

function runPowerShell(command, script) {
  return execFileSync(command, ["-NoProfile", "-Command", script], {
    encoding: "utf8",
  });
}

function extractPowerShellBlock(markdown, heading) {
  const section = markdown.slice(markdown.indexOf(heading));
  const match = /^```powershell\r?\n([\s\S]*?)^```$/m.exec(section);
  assert.ok(match, `Missing PowerShell block after ${heading}`);
  return match[1];
}

async function createUploadVerificationFixture(temporaryDirectory) {
  const releaseDirectory = path.join(temporaryDirectory, "dist", "windows-release");
  const relativePath = "cli/localapp-cli-x86_64-pc-windows-msvc.exe";
  const artifactPath = path.join(releaseDirectory, ...relativePath.split("/"));
  const artifactContent = "fixture cli artifact";
  const sha256 = createHash("sha256").update(artifactContent).digest("hex");
  const manifest = {
    artifacts: [{ bytes: Buffer.byteLength(artifactContent), path: relativePath, sha256 }],
    generatedAt: "2026-07-24T00:00:00.0000000Z",
    gitCommit: "0123456789abcdef0123456789abcdef01234567",
    mode: "Test",
    target: "Cli",
    toolchain: { node: "v24.0.0", pnpm: "10.0.0", rustc: "rustc 1.0.0" },
    updaterSignature: false,
  };

  await mkdir(path.dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, artifactContent);
  await writeFile(path.join(releaseDirectory, "manifest.json"), `${JSON.stringify(manifest)}\n`);
  await writeFile(path.join(releaseDirectory, "SHA256SUMS.txt"), `${sha256} *${relativePath}\n`);
}

test("declares the supported build interface", () => {
  assert.match(source, /ValidateSet\("All", "Cli", "Desktop"\)/);
  assert.match(source, /ValidateSet\("Test", "Release"\)/);
  assert.match(source, /dist[\\/]windows/);
});

test("reuses the canonical CLI release layout instead of Cargo target output", () => {
  assert.match(source, /pnpm" @\("build:cli"\)/);
  assert.match(source, /packages[\\/]server[\\/]static[\\/]cli/);
  assert.match(source, /versions\.json/);
  assert.match(source, /windows\/x86_64/);
  assert.match(source, /localapp-cli-x86_64-pc-windows-msvc\.exe/);
  assert.doesNotMatch(source, /packages[\\/]cli[\\/]target[\\/]release[\\/]localapp\.exe/);
});

test("uses explicit Tauri configs in both modes and keeps release fail-closed", () => {
  assert.match(source, /New-TestTauriConfig/);
  assert.match(source, /createUpdaterArtifacts\s*=\s*\$false/);
  assert.match(source, /windows-release-config\.mjs/);
  for (const name of [
    "LOCALAPP_UPDATER_ENDPOINT",
    "LOCALAPP_UPDATER_PUBKEY",
    "TAURI_SIGNING_PRIVATE_KEY",
    "LOCALAPP_WINDOWS_CERTIFICATE_THUMBPRINT",
    "LOCALAPP_WINDOWS_TIMESTAMP_URL",
  ]) {
    assert.match(source, new RegExp(name));
  }
});

test("writes a complete UTF-8 no-BOM manifest and checksums", () => {
  for (const field of [
    "gitCommit",
    "node",
    "pnpm",
    "rustc",
    "mode",
    "target",
    "generatedAt",
    "updaterSignature",
    "path",
    "bytes",
    "sha256",
  ]) {
    assert.match(source, new RegExp(field));
  }
  assert.match(source, /UTF8Encoding/);
  assert.match(source, /WriteAllText/);
  assert.doesNotMatch(source, /Set-Content.*(?:manifest|SHA256SUMS)/);
});

test("rejects stale output and validates every output boundary for reparse points", () => {
  assert.match(source, /Assert-OutputDirectoryEmpty/);
  assert.match(source, /Assert-DeclaredArtifactDirectoryContents/);
  assert.match(source, /OutputDirectory must be empty/);
  assert.match(source, /Assert-NoReparsePoints/);
  assert.match(source, /Assert-ArtifactDirectorySafe/);
  assert.match(source, /Copy-Artifact/);
  assert.match(source, /-BeforeCopy/);
  assert.match(source, /-AfterCopy/);
  assert.doesNotMatch(source, /Remove-Item[^\n]*-Recurse/);
});

test("rejects ARM64 and preserves failing external command exit codes", () => {
  assert.match(source, /ProcessArchitecture/);
  assert.match(source, /NativeArchitecture/);
  assert.match(source, /AMD64\|x86_64/);
  assert.match(source, /LastExternalExitCode/);
  assert.match(source, /PSNativeCommandUseErrorActionPreference/);
  assert.match(source, /exit \$script:LastExternalExitCode/);
});

test("the design requires a new or empty output directory", () => {
  assert.match(releaseDesign, /输出目录必须是新建目录或已存在的空目录/);
  assert.match(releaseDesign, /避免混入历史产物/);
  assert.doesNotMatch(releaseDesign, /只覆盖本次产物使用的固定\s*文件名/);
});

test("the upload guide verifies every declared artifact and uploads an explicit file list", () => {
  assert.match(releaseGuide, /Assert-NoReparsePointPath/);
  assert.match(releaseGuide, /New-Object IO\.DirectoryInfo/);
  assert.match(releaseGuide, /\$\{relativePath\}:/);
  assert.match(releaseGuide, /TrimStart\(\[char\[\]\]@\('\\', '\/'\)\)/);
  assert.match(releaseGuide, /ConvertFrom-Json/);
  assert.match(releaseGuide, /manifest\.artifacts/);
  assert.match(releaseGuide, /SHA256SUMS\.txt/);
  assert.match(releaseGuide, /unexpected file/i);
  assert.match(releaseGuide, /unexpected directory/i);
  assert.match(releaseGuide, /\$checksums\.Count -ne \(\@\(\$manifest\.artifacts\)\)\.Count/);
  assert.match(releaseGuide, /\$uploadFiles/);
  assert.match(releaseGuide, /foreach \(\$uploadFile in \$uploadFiles\)/);
  assert.match(releaseGuide, /scp -P 55666 \$uploadFile\.FullName/);
  assert.doesNotMatch(releaseGuide, /\$release\\\*/);
  assert.doesNotMatch(releaseGuide, /TAURI_SIGNING_PRIVATE_KEY_PASSWORD/);
  assert.doesNotMatch(desktopReadme, /TAURI_SIGNING_PRIVATE_KEY_PASSWORD/);
});

for (const powerShellCommand of powerShellCommands) {
  test(`${powerShellCommand} parses the release script`, () => {
    const scriptPath = quotePowerShell(fileURLToPath(scriptUrl));
    runPowerShell(
      powerShellCommand,
      `[void][ScriptBlock]::Create((Get-Content -LiteralPath '${scriptPath}' -Raw))`,
    );
  });

  test(`${powerShellCommand} top-level entry preserves a native exit code`, () => {
    const scriptPath = quotePowerShell(fileURLToPath(scriptUrl));
    const commandName = quotePowerShell(powerShellCommand);
    const result = spawnSync(powerShellCommand, ["-NoProfile", "-Command", `
      . '${scriptPath}'
      $PSNativeCommandUseErrorActionPreference = $true
      Invoke-ReleaseTopLevel { Invoke-External '${commandName}' @('-NoProfile', '-Command', 'exit 7') }
    `], {
      encoding: "utf8",
    });

    assert.equal(result.status, 7, result.stderr);
    assert.match(result.stderr, /exit code 7/);
  });

  test(`${powerShellCommand} parses the complete upload verification guide`, async (t) => {
    const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "localapp-upload-guide-"));
    t.after(() => rm(temporaryDirectory, { force: true, recursive: true }));

    const guidePath = path.join(temporaryDirectory, "verify-release.ps1");
    await writeFile(guidePath, uploadVerificationScript);
    const escapedGuidePath = quotePowerShell(guidePath);
    runPowerShell(
      powerShellCommand,
      `[void][ScriptBlock]::Create((Get-Content -LiteralPath '${escapedGuidePath}' -Raw))`,
    );
  });

  test(`${powerShellCommand} runs the upload verification guide against a release fixture`, async (t) => {
    const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "localapp-upload-guide-"));
    t.after(() => rm(temporaryDirectory, { force: true, recursive: true }));
    await createUploadVerificationFixture(temporaryDirectory);

    const guidePath = path.join(temporaryDirectory, "verify-release.ps1");
    await writeFile(guidePath, uploadVerificationScript);
    const escapedGuidePath = quotePowerShell(guidePath);
    const escapedTemporaryDirectory = quotePowerShell(await realpath(temporaryDirectory));
    const output = runPowerShell(
      powerShellCommand,
      `Set-Location -LiteralPath '${escapedTemporaryDirectory}'; & '${escapedGuidePath}'`,
    );

    assert.match(output, /Verified 1 artifacts/);
  });

  test(`${powerShellCommand} helpers enforce the Windows release safety contract`, async (t) => {
    const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "localapp-release-test-"));
    t.after(() => rm(temporaryDirectory, { force: true, recursive: true }));

    const scriptPath = quotePowerShell(fileURLToPath(scriptUrl));
    const temporaryPath = quotePowerShell(await realpath(temporaryDirectory));
    const commandName = quotePowerShell(powerShellCommand);
    const command = `
      . '${scriptPath}'
      try {
        Assert-WindowsX64 -OperatingSystem 'Linux' -ProcessArchitecture 'AMD64' -NativeArchitecture 'AMD64'
        throw 'platform guard did not reject Linux'
      } catch {
        if ($_.Exception.Message -notmatch 'must run on Windows') { throw }
      }
      Assert-WindowsX64 -OperatingSystem 'Windows_NT' -ProcessArchitecture 'AMD64' -NativeArchitecture 'AMD64'
      foreach ($architecture in @('ARM64', 'x86')) {
        try {
          Assert-WindowsX64 -OperatingSystem 'Windows_NT' -ProcessArchitecture $architecture -NativeArchitecture 'AMD64'
          throw "architecture guard accepted $architecture"
        } catch {
          if ($_.Exception.Message -notmatch 'AMD64') { throw }
        }
      }
      try {
        Assert-WindowsX64 -OperatingSystem 'Windows_NT' -ProcessArchitecture 'AMD64' -NativeArchitecture 'ARM64'
        throw 'native ARM64 guard was accepted'
      } catch {
        if ($_.Exception.Message -notmatch 'AMD64') { throw }
      }
      try {
        Assert-ReleaseEnvironment -BuildMode 'Release' -Environment @{}
        throw 'release environment guard did not reject missing variables'
      } catch {
        if ($_.Exception.Message -notmatch 'LOCALAPP_UPDATER_ENDPOINT, LOCALAPP_UPDATER_PUBKEY, TAURI_SIGNING_PRIVATE_KEY') { throw }
      }
      try {
        Invoke-External '${commandName}' @('-NoProfile', '-Command', "Write-Output 'diagnostic-line'; exit 7")
        throw 'external command guard did not reject a non-zero exit'
      } catch {
        if ($_.Exception.Message -notmatch 'exit code 7') { throw }
        if ($script:LastExternalExitCode -ne 7) { throw 'external exit code was not preserved' }
      }
      if ((Resolve-OutputPath ([IO.Path]::GetPathRoot((Get-Location).Path))) -eq '') { throw 'root path was normalized to an empty path' }
      $oldOutput = Join-Path '${temporaryPath}' 'old-output'
      New-Item -ItemType Directory -Path $oldOutput | Out-Null
      Set-Content -LiteralPath (Join-Path $oldOutput 'stale.txt') -Value 'stale' -NoNewline
      try {
        Initialize-OutputDirectory $oldOutput
        throw 'non-empty output directory was accepted'
      } catch {
        if ($_.Exception.Message -notmatch 'must be empty') { throw }
      }
      $output = Join-Path '${temporaryPath}' 'output'
      $destinationRoot = Initialize-OutputDirectory $output
      $source = Join-Path '${temporaryPath}' 'source.exe'
      Set-Content -LiteralPath $source -Value 'artifact' -NoNewline
      $artifacts = [System.Collections.Generic.List[IO.FileInfo]]::new()
      Copy-Artifact (Get-Item -LiteralPath $source) $destinationRoot 'cli' 'localapp-cli-x86_64-pc-windows-msvc.exe' $artifacts
      $desktopOutput = Join-Path '${temporaryPath}' 'desktop-output'
      $desktopRoot = Initialize-OutputDirectory $desktopOutput
      $installerSource = Join-Path '${temporaryPath}' 'installer.exe'
      $signatureSource = Join-Path '${temporaryPath}' 'installer.exe.sig'
      Set-Content -LiteralPath $installerSource -Value 'installer' -NoNewline
      Set-Content -LiteralPath $signatureSource -Value 'signature' -NoNewline
      $desktopArtifacts = [System.Collections.Generic.List[IO.FileInfo]]::new()
      Copy-Artifact (Get-Item -LiteralPath $installerSource) $desktopRoot 'desktop' 'LocalApp_0.1.0_x64-setup.exe' $desktopArtifacts
      Copy-Artifact (Get-Item -LiteralPath $signatureSource) $desktopRoot 'desktop' 'LocalApp_0.1.0_x64-setup.exe.sig' $desktopArtifacts
      if ($desktopArtifacts.Count -ne 2) { throw 'controlled Desktop artifact copies were not both retained' }
      try {
        Copy-Artifact (Get-Item -LiteralPath $installerSource) $desktopRoot 'desktop' 'LocalApp_0.1.0_x64-setup.exe' $desktopArtifacts
        throw 'existing artifact destination was accepted'
      } catch {
        if ($_.Exception.Message -notmatch 'destination already exists') { throw }
      }
      $staleOutput = Join-Path '${temporaryPath}' 'stale-artifact-output'
      $staleRoot = Initialize-OutputDirectory $staleOutput
      $staleDesktop = Join-Path $staleRoot 'desktop'
      New-Item -ItemType Directory -Path $staleDesktop | Out-Null
      Set-Content -LiteralPath (Join-Path $staleDesktop 'unexpected.exe') -Value 'stale' -NoNewline
      try {
        Copy-Artifact (Get-Item -LiteralPath $installerSource) $staleRoot 'desktop' 'LocalApp_0.1.0_x64-setup.exe' ([System.Collections.Generic.List[IO.FileInfo]]::new())
        throw 'undeclared stale artifact was accepted'
      } catch {
        if ($_.Exception.Message -notmatch 'undeclared') { throw }
      }
      $metadata = [ordered]@{
        gitCommit = '0123456789abcdef0123456789abcdef01234567'
        toolchain = [ordered]@{ node = 'v24.0.0'; pnpm = '10.0.0'; rustc = 'rustc 1.0.0' }
        target = 'Cli'
        mode = 'Test'
      }
      Write-ArtifactMetadata $destinationRoot $artifacts $metadata
      $manifest = Get-Content -LiteralPath (Join-Path $destinationRoot 'manifest.json') -Raw | ConvertFrom-Json
      if ($manifest.gitCommit -ne $metadata.gitCommit -or $manifest.toolchain.node -ne 'v24.0.0' -or $manifest.mode -ne 'Test' -or $manifest.target -ne 'Cli' -or $manifest.updaterSignature -ne $false) { throw 'manifest release metadata is incomplete' }
      if ($manifest.artifacts.Count -ne 1 -or $manifest.artifacts[0].path -ne 'cli/localapp-cli-x86_64-pc-windows-msvc.exe' -or $manifest.artifacts[0].bytes -lt 1 -or $manifest.artifacts[0].sha256 -notmatch '^[a-f0-9]{64}$') { throw 'manifest artifact record is incomplete' }
      $testConfig = Join-Path '${temporaryPath}' 'test-tauri.json'
      New-TestTauriConfig $testConfig @{ LOCALAPP_WINDOWS_CERTIFICATE_THUMBPRINT = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'; LOCALAPP_WINDOWS_TIMESTAMP_URL = 'https://timestamp.example.test' }
      $config = Get-Content -LiteralPath $testConfig -Raw | ConvertFrom-Json
      if ($config.bundle.createUpdaterArtifacts -ne $false -or $config.bundle.windows.certificateThumbprint -ne 'A1B2C3D4E5F60718293A4B5C6D7E8F9012345678' -or $config.bundle.windows.timestampUrl -ne 'https://timestamp.example.test/') { throw 'test merge config did not preserve explicit signing metadata' }
      try {
        New-TestTauriConfig (Join-Path '${temporaryPath}' 'bad-tauri.json') @{ LOCALAPP_WINDOWS_TIMESTAMP_URL = 'https://timestamp.example.test' }
        throw 'test merge config accepted a timestamp without a certificate'
      } catch {
        if ($_.Exception.Message -notmatch 'requires LOCALAPP_WINDOWS_CERTIFICATE_THUMBPRINT') { throw }
      }
      $cargo = Join-Path '${temporaryPath}' 'Cargo.toml'
      $versions = Join-Path '${temporaryPath}' 'versions.json'
      $cliDirectory = Join-Path '${temporaryPath}' 'cli'
      New-Item -ItemType Directory -Path (Join-Path $cliDirectory '1.2.3') -Force | Out-Null
      Set-Content -LiteralPath $cargo -Value ('[package]' + [Environment]::NewLine + 'version = "1.2.3"') -NoNewline
      Set-Content -LiteralPath $versions -Value '{"versions":{"1.2.3":{"platforms":{"windows/x86_64":"localapp-cli-x86_64-pc-windows-msvc.exe"}}}}' -NoNewline
      $cliPath = Join-Path $cliDirectory '1.2.3/localapp-cli-x86_64-pc-windows-msvc.exe'
      Set-Content -LiteralPath $cliPath -Value 'cli' -NoNewline
      if ((Get-CliArtifact $cargo $versions $cliDirectory).FullName -ne (Get-Item -LiteralPath $cliPath).FullName) { throw 'canonical CLI artifact was not selected' }
      Set-Content -LiteralPath $versions -Value '{"versions":{"1.2.3":{"platforms":{"windows/x86_64":"localapp.exe"}}}}' -NoNewline
      try {
        Get-CliArtifact $cargo $versions $cliDirectory
        throw 'non-canonical CLI mapping was accepted'
      } catch {
        if ($_.Exception.Message -notmatch 'canonical CLI filename') { throw }
      }
      if ($env:OS -eq 'Windows_NT') {
        $linkedOutput = Join-Path '${temporaryPath}' 'linked-output'
        $linkedTarget = Join-Path '${temporaryPath}' 'linked-target'
        New-Item -ItemType Directory -Path $linkedOutput, $linkedTarget | Out-Null
        New-Item -ItemType Junction -Path (Join-Path $linkedOutput 'cli') -Target $linkedTarget | Out-Null
        try {
          Assert-ArtifactDirectorySafe $linkedOutput 'cli' -BeforeCopy
          throw 'child junction was accepted'
        } catch {
          if ($_.Exception.Message -notmatch 'reparse point') { throw }
        }
      }
      Write-Output 'helpers-passed'
    `;
    const output = runPowerShell(powerShellCommand, command);

    assert.match(output, /diagnostic-line/);
    assert.match(output, /helpers-passed/);
  });
}

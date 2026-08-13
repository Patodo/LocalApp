import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const scriptPath = path.resolve(new URL("./build-windows-release.ps1", import.meta.url).pathname);
const source = fs.readFileSync(scriptPath, "utf8");
const powerShell = process.platform === "win32" ? "powershell.exe" : "pwsh";

test("Windows release surface names only the native adapter artifact", () => {
  assert.match(source, /packages[\\/]localapp/);
  assert.match(source, /build:native/);
  assert.doesNotMatch(source, /@\("-C", "packages\/localapp", "build"\)/);
  assert.match(source, /win32-x64/);
  assert.doesNotMatch(source, /packages[\\/](?:cli|desktop)|Tauri|NSIS|build:cli|localapp-server/i);
});

test("PowerShell helpers copy an exact native adapter tree and reject undeclared files", { skip: !hasPowerShell() }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "localapp-windows-release-"));
  try {
    const sourceDirectory = path.join(root, "native");
    const outputDirectory = path.join(root, "output");
    fs.mkdirSync(path.join(sourceDirectory, "win32-x64"), { recursive: true });
    fs.writeFileSync(path.join(sourceDirectory, "win32-x64", "localapp-native.exe"), "adapter");
    fs.writeFileSync(path.join(sourceDirectory, "win32-x64", "localapp-native-ipc-client.mjs"), "ipc");
    fs.writeFileSync(path.join(sourceDirectory, "adapter-manifest.json"), JSON.stringify({
      schemaVersion: 1,
      target: "win32-x64",
      signing: { mode: "adhoc" },
      assets: [
        { path: "win32-x64/localapp-native-ipc-client.mjs", sha256: digest("ipc") },
        { path: "win32-x64/localapp-native.exe", sha256: digest("adapter") },
      ],
    }));

    const command = [
      `$env:LOCALAPP_BUILD_WINDOWS_RELEASE_DOT_SOURCE_ONLY='1'`,
      `. '${escapePowerShell(scriptPath)}'`,
      `Copy-NativeAdapterArtifact '${escapePowerShell(sourceDirectory)}' '${escapePowerShell(outputDirectory)}'`,
      `if (!(Test-Path -LiteralPath '${escapePowerShell(path.join(outputDirectory, "win32-x64", "localapp-native.exe"))}')) { throw 'adapter missing' }`,
      `Set-Content -LiteralPath '${escapePowerShell(path.join(sourceDirectory, "unexpected.txt"))}' -Value 'bad'`,
      `try { Assert-NativeAdapterTree '${escapePowerShell(sourceDirectory)}'; throw 'unexpected file accepted' } catch { if ($_.Exception.Message -notmatch 'unexpected native adapter file') { throw } }`,
      `Write-Output 'helpers-passed'`,
    ].join("; ");

    const output = execFileSync(powerShell, ["-NoProfile", "-NonInteractive", "-Command", command], { encoding: "utf8" });
    assert.match(output, /helpers-passed/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function hasPowerShell() {
  return spawnSync(powerShell, ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"], { encoding: "utf8" }).status === 0;
}

function escapePowerShell(value) {
  return value.replaceAll("'", "''");
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./windows-vm-acceptance.ps1", import.meta.url), "utf8");

test("Windows acceptance requires a clean non-admin x64 machine without system Node", () => {
  assert.match(source, /\$env:OS -eq "Windows_NT"/);
  assert.match(source, /Is64BitOperatingSystem/);
  assert.match(source, /BuiltInRole\]::Administrator/);
  assert.match(source, /Get-Command node/);
  assert.match(source, /Get-Command npm/);
  assert.match(source, /windowsX64 = \$true/);
  assert.match(source, /nonAdministrator = \$true/);
  assert.match(source, /noSystemNpm = \$true/);
  assert.match(source, /disconnectedAtInstall = \$disconnectedAtInstall/);
  assert.match(source, /\[switch\]\$RequireWebView2Absent/);
  assert.match(source, /\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5\}/);
  assert.match(source, /HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients/);
  assert.match(source, /HKCU:\\Software\\Microsoft\\EdgeUpdate\\Clients/);
  assert.match(source, /WebView2 Runtime must be absent before installation/);
});

test("Windows acceptance verifies installer identity, current-user layout, and fixed runtime", () => {
  assert.match(source, /\[Parameter\(Mandatory = \$true\)\]\s*\[string\]\$ExpectedSha256/);
  assert.match(source, /Get-FileHash .*SHA256/);
  assert.match(source, /HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall/);
  assert.match(source, /localapp-desktop\.exe/);
  assert.match(source, /node\.exe/);
  assert.match(source, /npm-cli\.js/);
  assert.match(source, /localapp-runner\.mjs/);
  assert.match(source, /localapp-local-runtime\.mjs/);
  assert.match(source, /sql-wasm\.wasm/);
  assert.match(source, /HKCU:\\Software\\Classes\\localapp/);
});

test("Windows acceptance records upgrade, uninstall, and interactive workflow evidence", () => {
  assert.match(source, /com\.localapp\.desktop/);
  assert.match(source, /upgradeStatePreserved/);
  assert.match(source, /uninstallStatePreserved/);
  for (const check of [
    "offlineLaunch",
    "notifications",
    "favorites",
    "protocolActivation",
    "trustedAction",
    "twoLocalApps",
    "processTreeCancellation",
    "registryProxy",
    "signedUpdater",
    "autostartAndTray",
  ]) {
    assert.match(source, new RegExp(`${check} = Confirm-ManualCheck`));
  }
  assert.match(source, /ConvertTo-Json/);
  assert.match(source, /automation-passed-manual-not-run/);
  assert.match(source, /webView2AbsentBeforeInstall/);
  assert.match(source, /webView2VersionAfterInstall/);
  assert.match(source, /Assert-Condition \$passed "Manual acceptance check failed/);
  assert.match(source, /Assert-Condition \$upgradeChecked "Upgrade did not preserve/);
});

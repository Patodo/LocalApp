import { spawn } from "node:child_process";
import type { RuntimeLayout } from "./runtime-layout.js";

const VERIFY_TIMEOUT_MS = 8_000;

/**
 * Windows named pipes live in a global namespace, so the Unix control socket's
 * 0700 directory has no direct equivalent. The startup gate instead proves the
 * per-user runtime directory still belongs to the invoking user (directly or
 * through the Administrators group) before the control pipe is exposed. Any
 * inability to verify fails closed.
 */
export async function verifyWindowsRuntimeOwnership(layout: RuntimeLayout): Promise<boolean> {
  const systemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT ?? "C:\\Windows";
  const powershell = `${systemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
  const script = [
    "$errorActionPreference='Stop'",
    "try {",
    "  $dir = $env:LOCALAPP_VERIFY_DIR",
    "  if (-not $dir) { 'false'; exit }",
    "  $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()",
    "  $current = [string]$identity.User.Value",
    "  $owner = (Get-Acl -LiteralPath $dir).Owner",
    "  $ownerSid = ([System.Security.Principal.NTAccount]$owner).Translate([System.Security.Principal.SecurityIdentifier]).Value",
    "  if ($current -eq [string]$ownerSid) { 'true'; exit }",
    "  $isAdmin = @($identity.Groups | ForEach-Object { [string]$_.Value }) -contains 'S-1-5-32-544'",
    "  if ([string]$ownerSid -eq 'S-1-5-32-544' -and $isAdmin) { 'true'; exit }",
    "  'false'",
    "} catch { 'false' }",
  ].join("\n");
  return await new Promise<boolean>((resolve) => {
    let stdout = "";
    let settled = false;
    const settle = (value: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const child = spawn(powershell, ["-NoProfile", "-NonInteractive", "-Command", script], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
      env: { ...process.env, LOCALAPP_VERIFY_DIR: layout.runtimeDir },
    });
    const timer = setTimeout(() => {
      child.kill();
      settle(false);
    }, VERIFY_TIMEOUT_MS);
    timer.unref?.();
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => { stdout += chunk; });
    child.once("error", () => settle(false));
    child.once("close", () => settle(stdout.trim() === "true"));
  });
}

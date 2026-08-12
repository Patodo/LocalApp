import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import type { WindowsOwnedProcessHandle, WindowsProcessTreeAdapter } from "../process/process-tree.js";
import { lifecycleError } from "../errors.js";
import { selectNativeAdapter, type SelectedNativeAdapter } from "./adapter-selection.js";

export const NATIVE_NOTIFICATION_ENVELOPE_LIMIT_BYTES = 8 * 1024;

export type NativePermissionState = "not-determined" | "granted" | "denied" | "unsupported" | "unknown";
export interface NativeNotificationEnvelope {
  ticket: string;
  title: string;
  body: string;
  sourceLabel: string;
  priority: "normal" | "high";
  iconPath: string;
}

export interface NativeAdapter {
  installScheme(): Promise<void>;
  showNotification(envelope: NativeNotificationEnvelope): Promise<void>;
  permissionState(): Promise<NativePermissionState>;
  requestPermission(): Promise<NativePermissionState>;
}

export async function createNativeAdapter(root: string): Promise<NativeAdapter> {
  const selected = await selectNativeAdapter({ root });
  return {
    async installScheme() { await runNative(selected, ["--register"]); },
    async showNotification(envelope) {
      const canonical = validateNativeNotificationEnvelope(envelope);
      await runNative(selected, ["--show-notification", JSON.stringify(canonical)]);
    },
    async permissionState() { return parsePermission(await runNative(selected, ["--permission-state"])); },
    async requestPermission() { return parsePermission(await runNative(selected, ["--request-permission"])); },
  };
}

export function validateNativeNotificationEnvelope(value: unknown): NativeNotificationEnvelope {
  if (!record(value) || !exactKeys(value, ["ticket", "title", "body", "sourceLabel", "priority", "iconPath"])
    || typeof value.ticket !== "string" || !/^[A-Za-z0-9_-]{16,256}$/.test(value.ticket)
    || typeof value.title !== "string" || typeof value.body !== "string" || typeof value.sourceLabel !== "string"
    || (value.priority !== "normal" && value.priority !== "high") || typeof value.iconPath !== "string"
    || value.title.length === 0 || value.sourceLabel.length === 0 || value.iconPath.length === 0 || value.iconPath.includes("\0")
    || Buffer.byteLength(JSON.stringify(value), "utf8") > NATIVE_NOTIFICATION_ENVELOPE_LIMIT_BYTES) {
    throw lifecycleError("native_notification_invalid", "NATIVE_NOTIFICATION_INVALID");
  }
  return { ticket: value.ticket, title: value.title, body: value.body, sourceLabel: value.sourceLabel, priority: value.priority, iconPath: value.iconPath };
}

export function buildLinuxDesktopEntry(executable: string): string {
  if (!absoluteExecutable(executable)) throw lifecycleError("native_adapter_invalid", "The Linux native adapter path is invalid");
  return `[Desktop Entry]\nType=Application\nName=LocalApp\nNoDisplay=true\nExec=${desktopExecQuote(executable)} %u\nMimeType=x-scheme-handler/localapp;\n`;
}

export function buildWindowsSchemeRegistration(executable: string): Array<{ key: string; value: string }> {
  if (!windowsExecutable(executable)) throw lifecycleError("native_adapter_invalid", "The Windows native adapter path is invalid");
  const command = `${quoteWindows(executable)} "%1"`;
  return [
    { key: "HKCU\\Software\\Classes\\localapp", value: "URL:LocalApp Protocol" },
    { key: "HKCU\\Software\\Classes\\localapp\\URL Protocol", value: "" },
    { key: "HKCU\\Software\\Classes\\localapp\\shell\\open\\command", value: command },
    { key: "HKCU\\Software\\Classes\\LocalApp.AppNotification\\LocalServer32", value: `${quoteWindows(executable)} --notification-activation` },
  ];
}

export interface WindowsAtomicOwnershipApi<TProcess = { terminate(): void }, TJob = { close(): void }> {
  createSuspended(): TProcess;
  createKillOnCloseJob(): TJob;
  assignToJob(process: TProcess, job: TJob): void;
  resume(process: TProcess): void;
}

export function performWindowsAtomicOwnership<TProcess extends { terminate(): void }, TJob extends { close(): void }>(api: WindowsAtomicOwnershipApi<TProcess, TJob>): { process: TProcess; job: TJob } {
  let process: TProcess | undefined;
  let job: TJob | undefined;
  try {
    process = api.createSuspended();
    job = api.createKillOnCloseJob();
    api.assignToJob(process, job);
    api.resume(process);
    return { process, job };
  } catch (error) {
    try { process?.terminate(); } catch { /* always retain the original failure */ }
    try { job?.close(); } catch { /* a kill-on-close job still has to be released */ }
    throw error;
  }
}

export interface WindowsNativeHelper {
  spawn(command: string, args: readonly string[], options: SpawnOptions): WindowsOwnedProcessHandle;
}

/** Task 6 consumes this seam; native helpers must guarantee atomic ownership. */
export function createWindowsProcessTreeAdapter(helper: WindowsNativeHelper): WindowsProcessTreeAdapter {
  return { spawnOwned: (command, args, options) => helper.spawn(command, args, options) };
}

export function createWindowsProcessTreeAdapterFromEnvironment(): WindowsProcessTreeAdapter | undefined {
  if (process.platform !== "win32") return undefined;
  const release = process.env.LOCALAPP_RELEASE_PATH;
  if (!release) return undefined;
  // The release was digest-verified before daemon launch. The helper itself is
  // selected by an exact target path; no PATH lookup or shell command is used.
  const executable = `${release}\\runtime\\native\\win32-${process.arch}\\localapp-native.exe`;
  return createWindowsProcessTreeAdapter({
    spawn(command, args, options) {
      const child = spawn(executable, ["--job-owner", "--", command, ...args], { ...options, shell: false, windowsHide: true });
      return {
        child,
        treeExists: () => child.exitCode === null && child.signalCode === null,
        signalTree: () => { child.kill(); },
      };
    },
  });
}

export async function openValidatedExternalUrl(url: string): Promise<void> {
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw lifecycleError("browser_open_invalid", "The validated browser destination is invalid"); }
  if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password || parsed.hash) {
    throw lifecycleError("browser_open_invalid", "The validated browser destination is invalid");
  }
  if (process.platform === "darwin") return waitForChild(spawn("/usr/bin/open", [url], { shell: false, stdio: "ignore" }));
  if (process.platform === "linux") return waitForChild(spawn("xdg-open", [url], { shell: false, stdio: "ignore" }));
  if (process.platform === "win32") {
    const adapter = createWindowsProcessTreeAdapterFromEnvironment();
    if (adapter === undefined) throw lifecycleError("native_adapter_unsupported", "NATIVE_ADAPTER_UNSUPPORTED: the Windows opener is unavailable");
    // The bundled Windows helper owns ShellExecuteW; this branch deliberately
    // never constructs cmd.exe or a shell string.
    const handle = adapter.spawnOwned("--open-url", [url], { stdio: "ignore", shell: false, windowsHide: true });
    await waitForChild(handle.child);
    return;
  }
  throw lifecycleError("native_adapter_unsupported", `NATIVE_ADAPTER_UNSUPPORTED: no browser adapter is available for ${process.platform}`);
}

async function runNative(adapter: SelectedNativeAdapter, args: string[]): Promise<string> {
  const child = spawn(adapter.executable, args, { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout?.setEncoding("utf8"); child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk) => { stdout += chunk; }); child.stderr?.on("data", (chunk) => { stderr += chunk; });
  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(lifecycleError("native_adapter_failed", "The LocalApp native adapter command failed")));
  });
  if (stderr.length > 0 || stdout.length > 1024) throw lifecycleError("native_adapter_failed", "The LocalApp native adapter response is invalid");
  return stdout.trim();
}

function parsePermission(value: string): NativePermissionState {
  if (["not-determined", "granted", "denied", "unsupported", "unknown"].includes(value)) return value as NativePermissionState;
  throw lifecycleError("native_adapter_failed", "The LocalApp native adapter response is invalid");
}

function waitForChild(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(lifecycleError("browser_open_failed", "The LocalApp browser operation failed")));
  });
}

function desktopExecQuote(value: string): string {
  return value.replace(/([\\\s"'`$;&|<>()])/g, "\\$1");
}

function quoteWindows(value: string): string {
  return `"${value.replace(/(\\*)"/g, "$1$1\\\"").replace(/(\\+)$/g, "$1$1")}"`;
}

function absoluteExecutable(value: string): boolean {
  return value.length > 0 && value.startsWith("/") && !value.includes("\0") && !/[\r\n]/.test(value);
}

function windowsExecutable(value: string): boolean {
  return /^[A-Za-z]:\\/.test(value) && !value.includes("\0") && !/[\r\n]/.test(value);
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort(); const sorted = [...expected].sort();
  return keys.length === sorted.length && keys.every((key, index) => key === sorted[index]);
}

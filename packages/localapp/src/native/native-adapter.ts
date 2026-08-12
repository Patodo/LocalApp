import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import fs from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { WindowsOwnedProcessHandle, WindowsProcessTreeAdapter } from "../process/process-tree.js";
import { lifecycleError } from "../errors.js";
import { ACTIVATION_URL_LIMIT_BYTES } from "../activation/activation-url.js";
import { selectNativeAdapter } from "./adapter-selection.js";

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

export interface NativeCommandRunner {
  (command: string, args: readonly string[]): Promise<string>;
}

export interface NativeAdapterOptions {
  platform?: NodeJS.Platform;
  arch?: string;
  supportDir?: string;
  dataHome?: string;
  nodePath?: string;
  env?: NodeJS.ProcessEnv;
  run?: NativeCommandRunner;
}

/**
 * The native bridge is deliberately only an OS boundary. This factory owns
 * selected-target verification, per-user registration, and direct command
 * invocation; every URL still reaches the canonical Node IPC client unchanged.
 */
export async function createNativeAdapter(root: string, options: NativeAdapterOptions = {}): Promise<NativeAdapter> {
  const platform = options.platform ?? process.platform;
  const environment = options.env ?? process.env;
  const selected = await selectNativeAdapter({ root, platform, arch: options.arch ?? process.arch });
  const run = options.run ?? runCommand;
  const nodePath = options.nodePath ?? process.execPath;
  const bridgeConfigPath = nativeBridgeConfigPath(platform, options.supportDir, environment);

  return {
    async installScheme() {
      if (platform === "linux") {
        await installLinuxScheme({
          nodePath,
          ipcClientPath: selected.ipcClient,
          dataHome: options.dataHome ?? linuxDataHome(environment),
          run,
        });
        return;
      }

      await writeBridgeConfiguration({ platform, configPath: bridgeConfigPath, nodePath, ipcClientPath: selected.ipcClient });
      if (platform === "darwin") {
        await run(selected.executable, ["--register", bridgeConfigPath]);
        return;
      }
      if (platform === "win32") {
        const registration = createWindowsSchemeRegistrationInvocation(selected.executable, bridgeConfigPath);
        await run(registration.command, registration.args);
        return;
      }
      throw unsupported(platform);
    },
    async showNotification(envelope) {
      const canonical = validateNativeNotificationEnvelope(envelope, platform);
      if (platform !== "darwin") throw lifecycleError("native_notification_unsupported", "NATIVE_NOTIFICATION_UNSUPPORTED: LocalApp notifications are unavailable on this platform");
      await run(selected.executable, ["--show-notification", JSON.stringify(canonical)]);
    },
    async permissionState() {
      if (platform !== "darwin") return "unsupported";
      return parsePermission(await run(selected.executable, ["--permission-state"]));
    },
    async requestPermission() {
      if (platform !== "darwin") return "unsupported";
      return parsePermission(await run(selected.executable, ["--request-permission"]));
    },
  };
}

/** Applies the byte cap before field parsing or native command construction. */
export function validateNativeNotificationEnvelope(value: unknown, platform: NodeJS.Platform = process.platform): NativeNotificationEnvelope {
  if (!record(value)) throw invalidEnvelope();
  let serialized: string;
  try { serialized = JSON.stringify(value); } catch { throw invalidEnvelope(); }
  if (Buffer.byteLength(serialized, "utf8") > NATIVE_NOTIFICATION_ENVELOPE_LIMIT_BYTES
    || !exactKeys(value, ["ticket", "title", "body", "sourceLabel", "priority", "iconPath"])
    || typeof value.ticket !== "string" || !/^[A-Za-z0-9_-]{16,256}$/.test(value.ticket)
    || typeof value.title !== "string" || typeof value.body !== "string" || typeof value.sourceLabel !== "string"
    || (value.priority !== "normal" && value.priority !== "high") || typeof value.iconPath !== "string"
    || value.title.length === 0 || value.sourceLabel.length === 0 || !safeAbsoluteLocalPath(value.iconPath, platform)) {
    throw invalidEnvelope();
  }
  return { ticket: value.ticket, title: value.title, body: value.body, sourceLabel: value.sourceLabel, priority: value.priority, iconPath: value.iconPath };
}

export interface LinuxSchemeInstallOptions {
  nodePath: string;
  ipcClientPath: string;
  dataHome: string;
  run: NativeCommandRunner;
}

/** Installs only LocalApp's user desktop entry and scheme MIME association. */
export async function installLinuxScheme(options: LinuxSchemeInstallOptions): Promise<void> {
  if (!safeAbsoluteLocalPath(options.dataHome, "linux")) throw lifecycleError("native_adapter_invalid", "The Linux data directory is invalid");
  const desktop = buildLinuxDesktopEntry(options.nodePath, options.ipcClientPath);
  const applications = path.posix.join(options.dataHome, "applications");
  const filename = "localapp.desktop";
  const destination = path.posix.join(applications, filename);
  await fs.mkdir(applications, { recursive: true, mode: 0o700 });
  const current = await fs.readFile(destination, "utf8").catch((error: NodeJS.ErrnoException) => error.code === "ENOENT" ? undefined : Promise.reject(error));
  if (current !== desktop) await fs.writeFile(destination, desktop, { mode: 0o644 });
  await options.run("xdg-mime", ["default", filename, "x-scheme-handler/localapp"]);
}

/** Desktop Entry quoting: quote each argument, escape only spec-reserved bytes, and keep %u as a field code. */
export function buildLinuxDesktopEntry(nodePath: string, ipcClientPath: string): string {
  if (!safeAbsoluteLocalPath(nodePath, "linux") || !safeAbsoluteLocalPath(ipcClientPath, "linux")) {
    throw lifecycleError("native_adapter_invalid", "The Linux native adapter paths are invalid");
  }
  return `[Desktop Entry]\nType=Application\nName=LocalApp\nNoDisplay=true\nExec=${desktopExecQuote(nodePath)} ${desktopExecQuote(ipcClientPath)} %u\nMimeType=x-scheme-handler/localapp;\n`;
}

export interface WindowsRegistryValue { key: string; value: string; name?: string; }

export function buildWindowsSchemeRegistration(executable: string, configPath: string): WindowsRegistryValue[] {
  if (!safeAbsoluteLocalPath(executable, "win32") || !safeAbsoluteLocalPath(configPath, "win32")) {
    throw lifecycleError("native_adapter_invalid", "The Windows native adapter path is invalid");
  }
  const command = `${quoteWindows(executable)} --scheme --config ${quoteWindows(configPath)} "%1"`;
  return [
    { key: "HKCU\\Software\\Classes\\localapp", value: "URL:LocalApp Protocol" },
    { key: "HKCU\\Software\\Classes\\localapp", name: "URL Protocol", value: "" },
    { key: "HKCU\\Software\\Classes\\localapp\\shell\\open\\command", value: command },
  ];
}

/** Registration is a fixed native HKCU operation, never a shell or reg.exe invocation. */
export function createWindowsSchemeRegistrationInvocation(executable: string, configPath: string): { command: string; args: string[] } {
  if (!safeAbsoluteLocalPath(executable, "win32") || !safeAbsoluteLocalPath(configPath, "win32")) {
    throw lifecycleError("native_adapter_invalid", "The Windows Scheme registration arguments are invalid");
  }
  return { command: executable, args: ["--register", "--config", configPath] };
}

export function createWindowsSchemeForwardInvocation(executable: string, configPath: string, url: string): { command: string; args: string[] } {
  if (!safeAbsoluteLocalPath(executable, "win32") || !safeAbsoluteLocalPath(configPath, "win32") || typeof url !== "string" || url.length === 0
    || url.includes("\0") || Buffer.byteLength(url, "utf8") > ACTIVATION_URL_LIMIT_BYTES) {
    throw lifecycleError("native_adapter_invalid", "The Windows Scheme forwarding arguments are invalid");
  }
  return { command: executable, args: ["--scheme", "--config", configPath, url] };
}

interface BridgeConfiguration {
  nodePath: string;
  ipcClientPath: string;
}

async function writeBridgeConfiguration(options: { platform: NodeJS.Platform; configPath: string; nodePath: string; ipcClientPath: string }): Promise<void> {
  if (!safeAbsoluteLocalPath(options.configPath, options.platform) || !safeAbsoluteLocalPath(options.nodePath, options.platform)
    || !safeAbsoluteLocalPath(options.ipcClientPath, options.platform)) {
    throw lifecycleError("native_adapter_invalid", "The native bridge configuration is invalid");
  }
  const content = `${JSON.stringify({ nodePath: options.nodePath, ipcClientPath: options.ipcClientPath } satisfies BridgeConfiguration)}\n`;
  await fs.mkdir(path.dirname(options.configPath), { recursive: true, mode: 0o700 });
  const current = await fs.readFile(options.configPath, "utf8").catch((error: NodeJS.ErrnoException) => error.code === "ENOENT" ? undefined : Promise.reject(error));
  if (current !== content) await fs.writeFile(options.configPath, content, { mode: 0o600 });
}

function nativeBridgeConfigPath(platform: NodeJS.Platform, supportDir: string | undefined, env: NodeJS.ProcessEnv): string {
  if (supportDir !== undefined) return platform === "win32" ? path.win32.join(supportDir, "native-bridge.json") : path.join(supportDir, "native-bridge.json");
  if (platform === "darwin") return path.join(homedir(), "Library", "Application Support", "LocalApp", "native-bridge.json");
  if (platform === "win32") return path.win32.join(env.LOCALAPPDATA ?? path.win32.join(homedir(), "AppData", "Local"), "LocalApp", "native-bridge.json");
  return path.join(env.XDG_DATA_HOME ?? path.join(homedir(), ".local", "share"), "localapp", "native-bridge.json");
}

function linuxDataHome(env: NodeJS.ProcessEnv): string {
  return env.XDG_DATA_HOME ?? path.join(homedir(), ".local", "share");
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
    try { process?.terminate(); } catch { /* retain the original failure */ }
    try { job?.close(); } catch { /* a kill-on-close job must be released */ }
    throw error;
  }
}

export interface WindowsNativeHelper {
  spawn(command: string, args: readonly string[], options: SpawnOptions): WindowsOwnedProcessHandle;
}

/** Task 6 consumes this seam; the helper receives the executable and argv as separate values. */
export function createWindowsProcessTreeAdapter(helper: WindowsNativeHelper): WindowsProcessTreeAdapter {
  return { spawnOwned: (command, args, options) => helper.spawn(command, args, options) };
}

export function createWindowsProcessTreeAdapterFromEnvironment(): WindowsProcessTreeAdapter | undefined {
  if (process.platform !== "win32") return undefined;
  const executable = windowsNativeExecutableFromEnvironment();
  if (executable === undefined) return undefined;
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
    const executable = windowsNativeExecutableFromEnvironment();
    if (executable === undefined) throw lifecycleError("native_adapter_unsupported", "NATIVE_ADAPTER_UNSUPPORTED: the Windows opener is unavailable");
    await waitForChild(spawn(executable, ["--open-url", url], { shell: false, stdio: "ignore", windowsHide: true }));
    return;
  }
  throw unsupported(process.platform);
}

function windowsNativeExecutableFromEnvironment(): string | undefined {
  const release = process.env.LOCALAPP_RELEASE_PATH;
  if (!release) return undefined;
  return path.join(release, "runtime", "native", `win32-${process.arch}`, "localapp-native.exe");
}

async function runCommand(command: string, args: readonly string[]): Promise<string> {
  const child = spawn(command, [...args], { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
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
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"").replace(/\$/g, "\\$").replace(/`/g, "\\`").replace(/%/g, "%%")}"`;
}

function quoteWindows(value: string): string {
  return `"${value.replace(/(\\*)"/g, "$1$1\\\"").replace(/(\\+)$/g, "$1$1")}"`;
}

function safeAbsoluteLocalPath(value: string, platform: NodeJS.Platform): boolean {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0") || /[\r\n]/.test(value) || /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value)) return false;
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  if (!pathApi.isAbsolute(value) || pathApi.normalize(value) !== value) return false;
  return !value.split(/[\\/]/).some((part) => part === "." || part === "..");
}

function invalidEnvelope(): ReturnType<typeof lifecycleError> {
  return lifecycleError("native_notification_invalid", "NATIVE_NOTIFICATION_INVALID");
}

function unsupported(platform: string): ReturnType<typeof lifecycleError> {
  return lifecycleError("native_adapter_unsupported", `NATIVE_ADAPTER_UNSUPPORTED: no native adapter is available for ${platform}`);
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort(); const sorted = [...expected].sort();
  return keys.length === sorted.length && keys.every((key, index) => key === sorted[index]);
}

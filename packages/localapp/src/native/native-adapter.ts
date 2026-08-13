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
  identifier: string;
  ticket: string;
  productLabel: "LocalApp";
  applicationLabel: string;
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
  shutdown(): Promise<void>;
}

export interface NativeCommandRunner {
  (command: string, args: readonly string[]): Promise<string>;
}

export interface LinuxNotificationSession {
  permissionState(): Promise<NativePermissionState>;
  requestPermission(): Promise<NativePermissionState>;
  showNotification(envelope: NativeNotificationEnvelope, activationUrl: string): Promise<{ actions: boolean }>;
  shutdown(): Promise<void>;
}

export interface NativeAdapterOptions {
  platform?: NodeJS.Platform;
  arch?: string;
  supportDir?: string;
  dataHome?: string;
  nodePath?: string;
  env?: NodeJS.ProcessEnv;
  run?: NativeCommandRunner;
  permissionTimeoutMs?: number;
  commandTimeoutMs?: number;
  verifyIcon?: (iconPath: string) => Promise<boolean>;
  linuxNotifications?: LinuxNotificationSession;
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
  const permissionTimeoutMs = boundedTimeout(options.permissionTimeoutMs, 12_000);
  const commandTimeoutMs = boundedTimeout(options.commandTimeoutMs, 12_000);
  const run = options.run === undefined
    ? (command: string, args: readonly string[], timeoutMs: number) => runCommand(command, args, timeoutMs, environment)
    : (command: string, args: readonly string[], timeoutMs: number) => settleWithin(options.run!(command, args), timeoutMs);
  const nodePath = options.nodePath ?? process.execPath;
  const bridgeConfigPath = nativeBridgeConfigPath(platform, options.supportDir, environment);
  const verifyIcon = options.verifyIcon ?? verifyRegularLocalFile;
  const linuxNotifications = platform === "linux"
    ? options.linuxNotifications ?? createPackagedLinuxNotificationSession(selected, nodePath, environment, commandTimeoutMs)
    : undefined;
  let stopped = false;

  return {
    async installScheme() {
      if (platform === "linux") {
        await installLinuxScheme({
          nodePath,
          ipcClientPath: selected.ipcClient,
          dataHome: options.dataHome ?? linuxDataHome(environment),
          run: (command, args) => run(command, args, commandTimeoutMs),
        });
        return;
      }

      await writeBridgeConfiguration({
        platform,
        configPath: bridgeConfigPath,
        nodePath,
        ipcClientPath: selected.ipcClient,
        environment: bridgeRuntimeEnvironment(environment, platform),
      });
      if (platform === "darwin") {
        await run(selected.executable, ["--register", bridgeConfigPath], commandTimeoutMs);
        return;
      }
      if (platform === "win32") {
        const registration = createWindowsSchemeRegistrationInvocation(selected.executable, bridgeConfigPath);
        await run(registration.command, registration.args, commandTimeoutMs);
        return;
      }
      throw unsupported(platform);
    },
    async showNotification(envelope) {
      const canonical = validateNativeNotificationEnvelope(envelope, platform);
      if (!(await verifyIcon(canonical.iconPath))) throw invalidEnvelope();
      if (platform === "linux") {
        await settleWithin(linuxNotifications!.showNotification(canonical, notificationActivationUrl(canonical.ticket)), commandTimeoutMs);
        return;
      }
      if (platform === "darwin" || platform === "win32") {
        await run(selected.executable, ["--show-notification", JSON.stringify(canonical)], commandTimeoutMs);
        return;
      }
      throw lifecycleError("native_notification_unsupported", "NATIVE_NOTIFICATION_UNSUPPORTED: LocalApp notifications are unavailable on this platform");
    },
    async permissionState() {
      if (platform === "linux") return settleWithin(linuxNotifications!.permissionState(), permissionTimeoutMs);
      if (platform === "darwin" || platform === "win32") {
        return parsePermission(await run(selected.executable, ["--permission-state"], permissionTimeoutMs));
      }
      return "unsupported";
    },
    async requestPermission() {
      if (platform === "linux") return settleWithin(linuxNotifications!.requestPermission(), permissionTimeoutMs);
      if (platform === "darwin" || platform === "win32") {
        return parsePermission(await run(selected.executable, ["--request-permission"], permissionTimeoutMs));
      }
      return "unsupported";
    },
    async shutdown() {
      if (stopped) return;
      stopped = true;
      await linuxNotifications?.shutdown();
    },
  };
}

/** Applies the byte cap before field parsing or native command construction. */
export function validateNativeNotificationEnvelope(value: unknown, platform: NodeJS.Platform = process.platform): NativeNotificationEnvelope {
  if (!record(value)) throw invalidEnvelope();
  let serialized: string;
  try { serialized = JSON.stringify(value); } catch { throw invalidEnvelope(); }
  if (Buffer.byteLength(serialized, "utf8") > NATIVE_NOTIFICATION_ENVELOPE_LIMIT_BYTES
    || !exactKeys(value, ["identifier", "ticket", "productLabel", "applicationLabel", "sourceLabel", "title", "body", "priority", "iconPath"])
    || typeof value.identifier !== "string" || !/^[A-Za-z0-9_-]{16,256}$/.test(value.identifier)
    || typeof value.ticket !== "string" || !/^[A-Za-z0-9_-]{16,256}$/.test(value.ticket)
    || value.productLabel !== "LocalApp" || typeof value.applicationLabel !== "string"
    || typeof value.title !== "string" || typeof value.body !== "string" || typeof value.sourceLabel !== "string"
    || (value.priority !== "normal" && value.priority !== "high") || typeof value.iconPath !== "string"
    || value.applicationLabel.length === 0 || value.applicationLabel.length > 128
    || value.title.length === 0 || value.sourceLabel.length === 0 || value.sourceLabel.length > 128
    || !plainNotificationText(value.applicationLabel) || !plainNotificationText(value.title)
    || !plainNotificationText(value.body) || !plainNotificationText(value.sourceLabel)
    || !safeAbsoluteLocalPath(value.iconPath, platform)) {
    throw invalidEnvelope();
  }
  return {
    identifier: value.identifier,
    ticket: value.ticket,
    productLabel: value.productLabel,
    applicationLabel: value.applicationLabel,
    sourceLabel: value.sourceLabel,
    title: value.title,
    body: value.body,
    priority: value.priority,
    iconPath: value.iconPath,
  };
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
  environment?: Partial<Record<"LOCALAPP_SUPPORT_DIR" | "LOCALAPP_RUNTIME_DIR" | "LOCALAPP_DATA_DIR", string>>;
}

async function writeBridgeConfiguration(options: BridgeConfiguration & { platform: NodeJS.Platform; configPath: string }): Promise<void> {
  if (!safeAbsoluteLocalPath(options.configPath, options.platform) || !safeAbsoluteLocalPath(options.nodePath, options.platform)
    || !safeAbsoluteLocalPath(options.ipcClientPath, options.platform)
    || Object.values(options.environment ?? {}).some((value) => !safeAbsoluteLocalPath(value, options.platform))) {
    throw lifecycleError("native_adapter_invalid", "The native bridge configuration is invalid");
  }
  const configuration: BridgeConfiguration = { nodePath: options.nodePath, ipcClientPath: options.ipcClientPath };
  if (options.environment !== undefined) configuration.environment = options.environment;
  const content = `${JSON.stringify(configuration)}\n`;
  await fs.mkdir(path.dirname(options.configPath), { recursive: true, mode: 0o700 });
  const current = await fs.readFile(options.configPath, "utf8").catch((error: NodeJS.ErrnoException) => error.code === "ENOENT" ? undefined : Promise.reject(error));
  if (current !== content) await fs.writeFile(options.configPath, content, { mode: 0o600 });
}

function bridgeRuntimeEnvironment(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): BridgeConfiguration["environment"] {
  const keys = ["LOCALAPP_SUPPORT_DIR", "LOCALAPP_RUNTIME_DIR", "LOCALAPP_DATA_DIR"] as const;
  const environment: NonNullable<BridgeConfiguration["environment"]> = {};
  for (const key of keys) {
    const value = env[key];
    if (value === undefined) continue;
    if (!safeAbsoluteLocalPath(value, platform)) throw lifecycleError("native_adapter_invalid", "The native bridge runtime layout is invalid");
    environment[key] = value;
  }
  return Object.keys(environment).length === 0 ? undefined : environment;
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

async function runCommand(command: string, args: readonly string[], timeoutMs: number, environment: NodeJS.ProcessEnv = process.env): Promise<string> {
  const child = spawn(command, [...args], { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: environment });
  let stdout = "";
  let stderr = "";
  let timedOut = false;
  child.stdout?.setEncoding("utf8"); child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk) => { stdout += chunk; }); child.stderr?.on("data", (chunk) => { stderr += chunk; });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    timer.unref();
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("exit", (code) => {
      clearTimeout(timer);
      if (timedOut) reject(timeoutError());
      else code === 0 ? resolve() : reject(lifecycleError("native_adapter_failed", "The LocalApp native adapter command failed"));
    });
  });
  if (stderr.length > 0 || stdout.length > 1024) throw lifecycleError("native_adapter_failed", "The LocalApp native adapter response is invalid");
  return stdout.trim();
}

function settleWithin<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(timeoutError()), timeoutMs);
    timer.unref();
    operation.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

function boundedTimeout(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1 || value > 60_000) {
    throw lifecycleError("native_adapter_invalid", "The native adapter timeout is invalid");
  }
  return value;
}

async function verifyRegularLocalFile(iconPath: string): Promise<boolean> {
  try {
    const stat = await fs.lstat(iconPath);
    return stat.isFile() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

function notificationActivationUrl(ticket: string): string {
  return `localapp://notification/open?ticket=${ticket}`;
}

class PackagedLinuxNotificationSession implements LinuxNotificationSession {
  private readonly helper: string;
  private readonly nodePath: string;
  private readonly ipcClientPath: string;
  private readonly environment: NodeJS.ProcessEnv;
  private readonly timeoutMs: number;
  private readonly active = new Map<string, { id: number; child: ChildProcess }>();
  private stopped = false;

  constructor(helper: string, nodePath: string, ipcClientPath: string, environment: NodeJS.ProcessEnv, timeoutMs: number) {
    this.helper = helper;
    this.nodePath = nodePath;
    this.ipcClientPath = ipcClientPath;
    this.environment = environment;
    this.timeoutMs = timeoutMs;
  }

  async permissionState(): Promise<NativePermissionState> {
    if (this.stopped) return "unsupported";
    return parsePermission(await runCommand(this.helper, ["--permission-state"], this.timeoutMs, this.environment));
  }

  async requestPermission(): Promise<NativePermissionState> {
    if (this.stopped) return "unsupported";
    return parsePermission(await runCommand(this.helper, ["--request-permission"], this.timeoutMs, this.environment));
  }

  async showNotification(envelope: NativeNotificationEnvelope, activationUrl: string): Promise<{ actions: boolean }> {
    if (this.stopped || activationUrl !== notificationActivationUrl(envelope.ticket)) {
      throw lifecycleError("native_adapter_failed", "The Linux notification session is unavailable");
    }
    const previous = this.active.get(envelope.identifier);
    const args = [
      "--show-notification", JSON.stringify(envelope),
      "--node", this.nodePath,
      "--ipc-client", this.ipcClientPath,
      "--replace-id", String(previous?.id ?? 0),
    ];
    const child = spawn(this.helper, args, {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: this.environment,
    });
    const accepted = await readLinuxAccepted(child, this.timeoutMs);
    if (previous !== undefined && previous.child !== child) previous.child.kill();
    if (accepted.actions) {
      this.active.set(envelope.identifier, { id: accepted.notificationId, child });
      child.once("exit", () => {
        if (this.active.get(envelope.identifier)?.child === child) this.active.delete(envelope.identifier);
      });
    }
    return { actions: accepted.actions };
  }

  async shutdown(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    const children = [...this.active.values()].map((entry) => entry.child);
    this.active.clear();
    await Promise.all(children.map(async (child) => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill();
      await settleWithin(new Promise<void>((resolve) => child.once("exit", () => resolve())), this.timeoutMs).catch(() => undefined);
    }));
  }
}

function createPackagedLinuxNotificationSession(
  selected: Awaited<ReturnType<typeof selectNativeAdapter>>,
  nodePath: string,
  environment: NodeJS.ProcessEnv,
  timeoutMs: number,
): LinuxNotificationSession {
  const relative = `${selected.target}/localapp-notifications`;
  if (!selected.assets.some((asset) => asset.path === relative)) return unsupportedLinuxNotificationSession();
  return new PackagedLinuxNotificationSession(path.join(selected.root, ...relative.split("/")), nodePath, selected.ipcClient, environment, timeoutMs);
}

function readLinuxAccepted(child: ChildProcess, timeoutMs: number): Promise<{ actions: boolean; notificationId: number }> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderrBytes = 0;
    let settled = false;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      reject(error);
    };
    const timer = setTimeout(() => fail(timeoutError()), timeoutMs);
    timer.unref();
    child.once("error", fail);
    child.once("exit", () => fail(lifecycleError("native_adapter_failed", "The Linux notification helper exited before accepting the notification")));
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderrBytes += Buffer.byteLength(chunk);
      if (stderrBytes > 1024) fail(lifecycleError("native_adapter_failed", "The Linux notification helper response is invalid"));
    });
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      if (settled) return;
      stdout += chunk;
      if (Buffer.byteLength(stdout, "utf8") > 1024) {
        fail(lifecycleError("native_adapter_failed", "The Linux notification helper response is invalid"));
        return;
      }
      const newline = stdout.indexOf("\n");
      if (newline < 0) return;
      let value: unknown;
      try { value = JSON.parse(stdout.slice(0, newline)); } catch { fail(lifecycleError("native_adapter_failed", "The Linux notification helper response is invalid")); return; }
      if (!record(value) || !exactKeys(value, ["accepted", "actions", "notificationId"])
        || value.accepted !== true || typeof value.actions !== "boolean"
        || !Number.isSafeInteger(value.notificationId) || (value.notificationId as number) < 1 || (value.notificationId as number) > 0xffff_ffff) {
        fail(lifecycleError("native_adapter_failed", "The Linux notification helper response is invalid"));
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({ actions: value.actions, notificationId: value.notificationId as number });
    });
  });
}

function unsupportedLinuxNotificationSession(): LinuxNotificationSession {
  return {
    permissionState: async () => "unsupported",
    requestPermission: async () => "unsupported",
    showNotification: async () => { throw lifecycleError("native_notification_unsupported", "NATIVE_NOTIFICATION_UNSUPPORTED: the Linux desktop notification service is unavailable"); },
    shutdown: async () => undefined,
  };
}

function plainNotificationText(value: string): boolean {
  return !/[\u0000-\u001f\u007f<>]/.test(value);
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

function timeoutError(): ReturnType<typeof lifecycleError> {
  return lifecycleError("native_adapter_timeout", "NATIVE_ADAPTER_TIMEOUT: the native adapter did not settle in time");
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

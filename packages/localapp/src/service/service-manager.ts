import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import { lifecycleError } from "../errors.js";
import type { RuntimeLayout } from "../daemon/runtime-layout.js";
import { createLinuxSystemdUserService } from "./linux-systemd-user.js";
import { createMacosLaunchAgent } from "./macos-launch-agent.js";
import { createWindowsUserTask } from "./windows-user-task.js";

export interface ServiceCommandInvocation {
  command: string;
  args: string[];
  signal?: AbortSignal;
}

export interface ServiceCommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type ServiceCommandRunner = (invocation: ServiceCommandInvocation) => Promise<ServiceCommandResult>;

export interface ServiceInstallResult {
  mode: "service" | "foreground";
  installed: boolean;
  reason?: string;
}

export interface ServiceManager {
  readonly registrationPath: string;
  install(): Promise<ServiceInstallResult>;
  /**
   * Starts the current-user daemon. If `signal` aborts, this must settle only
   * after every owned service command has closed and been reaped (or before
   * one was created); observing abort alone is not sufficient.
   */
  start(signal?: AbortSignal): Promise<void>;
  stop(): Promise<void>;
  restart(): Promise<void>;
  status(): Promise<boolean>;
  uninstall(): Promise<void>;
  logs(lines?: number): Promise<string>;
}

export interface CreateServiceManagerOptions {
  platform?: NodeJS.Platform;
  layout: RuntimeLayout;
  nodePath: string;
  homeDir: string;
  uid?: number;
  env?: Record<string, string | undefined>;
  serviceEnvironment?: Record<string, string>;
  run: ServiceCommandRunner;
}

export interface PlatformServiceOptions extends CreateServiceManagerOptions {
  platform: NodeJS.Platform;
  serviceEnvironment: Record<string, string>;
}

export function createServiceManager(options: CreateServiceManagerOptions): ServiceManager {
  const platform = options.platform ?? process.platform;
  const serviceEnvironment = validateServiceEnvironment(options.serviceEnvironment ?? {});
  const normalized: PlatformServiceOptions = { ...options, platform, serviceEnvironment };
  if (platform === "darwin") return withLogs(createMacosLaunchAgent(normalized), options.layout);
  if (platform === "win32") return withLogs(createWindowsUserTask(normalized), options.layout);
  if (platform === "linux") return withLogs(createLinuxSystemdUserService(normalized), options.layout);
  throw lifecycleError("user_service_unsupported", `LocalApp user services are unsupported on ${platform}`);
}

/** Creates the sole current-user service boundary used by CLI and native IPC. */
export function createCurrentUserServiceManager(layout: RuntimeLayout): ServiceManager {
  return createServiceManager({
    layout,
    nodePath: process.execPath,
    homeDir: process.env.HOME ?? process.env.USERPROFILE ?? process.cwd(),
    run: createSpawnServiceCommandRunner(),
  });
}

/**
 * Binds the broker deadline signal to spawn and settles only on `close`, so an
 * aborted owned service command is reaped before ServiceManager.start settles.
 */
export function createSpawnServiceCommandRunner(): ServiceCommandRunner {
  return async ({ command, args, signal }) => await new Promise((resolve) => {
    if (signal?.aborted) { resolve({ code: 1, stdout: "", stderr: "aborted" }); return; }
    const child = spawn(command, args, {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      // A service command that traps SIGTERM must not outlive the one broker
      // deadline. Node maps this to forced process termination on Windows too.
      ...(signal === undefined ? {} : { signal, killSignal: "SIGKILL" }),
    });
    let stdout = ""; let stderr = ""; let settled = false;
    const finish = (code: number) => {
      if (settled) return;
      settled = true;
      resolve({ code, stdout, stderr });
    };
    child.stdout?.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
    child.once("error", (error) => {
      stderr += error.message;
      if (child.pid === undefined) finish(1);
    });
    child.once("close", (code) => finish(code ?? 1));
  });
}

export async function runServiceCommand(
  run: ServiceCommandRunner,
  invocation: ServiceCommandInvocation,
  toleratedCodes: readonly number[] = [],
): Promise<ServiceCommandResult> {
  let result: ServiceCommandResult;
  try {
    result = await run(invocation);
  } catch {
    throw lifecycleError("user_service_command_unavailable", "The current-user service manager is unavailable");
  }
  if (result.code !== 0 && !toleratedCodes.includes(result.code)) {
    throw lifecycleError("user_service_command_failed", "The current-user service manager command failed");
  }
  return result;
}

export function withAbortSignal(invocation: ServiceCommandInvocation, signal: AbortSignal | undefined): ServiceCommandInvocation {
  return signal === undefined ? invocation : { ...invocation, signal };
}

function validateServiceEnvironment(value: Record<string, string>): Record<string, string> {
  const output: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(key) || /(API_?KEY|PASSWORD|SECRET|TOKEN|CREDENTIAL)/i.test(key)
      || typeof entry !== "string" || entry.includes("\0") || entry.length > 4096) {
      throw lifecycleError("user_service_configuration_invalid", "The LocalApp user service configuration is invalid");
    }
    output[key] = entry;
  }
  return output;
}

function withLogs(manager: Omit<ServiceManager, "logs">, layout: RuntimeLayout): ServiceManager {
  return {
    ...manager,
    async logs(lines = 200): Promise<string> {
      if (!Number.isSafeInteger(lines) || lines < 1 || lines > 10_000) {
        throw lifecycleError("user_service_logs_invalid", "The requested log line count is invalid");
      }
      const handle = await fs.open(layout.daemonLogPath, "r").catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      });
      if (handle === undefined) return "";
      try {
        const stat = await handle.stat();
        const cap = 1024 * 1024;
        const size = Math.min(stat.size, cap);
        const buffer = Buffer.alloc(size);
        await handle.read(buffer, 0, size, Math.max(0, stat.size - size));
        const text = buffer.toString("utf8");
        const tail = text.split(/\r?\n/).slice(-(lines + 1), -1).join("\n");
        return stat.size > cap ? `[truncated to ${cap} bytes]\n${tail}` : tail;
      } finally { await handle.close(); }
    },
  };
}

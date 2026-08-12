import fs from "node:fs/promises";
import { lifecycleError } from "../errors.js";
import type { RuntimeLayout } from "../daemon/runtime-layout.js";
import { createLinuxSystemdUserService } from "./linux-systemd-user.js";
import { createMacosLaunchAgent } from "./macos-launch-agent.js";
import { createWindowsUserTask } from "./windows-user-task.js";

export interface ServiceCommandInvocation {
  command: string;
  args: string[];
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
  start(): Promise<void>;
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
      const value = await fs.readFile(layout.daemonLogPath, "utf8").catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return "";
        throw error;
      });
      return value.split(/\r?\n/).slice(-(lines + 1), -1).join("\n");
    },
  };
}

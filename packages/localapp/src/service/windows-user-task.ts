import fs from "node:fs/promises";
import path from "node:path";
import { lifecycleError } from "../errors.js";
import type { PlatformServiceOptions, ServiceInstallResult, ServiceManager } from "./service-manager.js";
import { runServiceCommand, withAbortSignal } from "./service-manager.js";
import { writeServiceFile } from "./service-files.js";

const TASK_NAME = "LocalApp User Daemon";

export function createWindowsUserTask(options: PlatformServiceOptions): Omit<ServiceManager, "logs"> {
  const registrationPath = path.join(options.layout.supportDir, "service", "windows-user-task.json");
  const systemRoot = options.env?.SystemRoot ?? options.env?.SYSTEMROOT ?? "C:\\Windows";
  const scheduler = path.win32.join(systemRoot, "System32", "schtasks.exe");
  const taskCommand = `${quoteWindowsArgument(options.nodePath)} ${quoteWindowsArgument(options.layout.launcherPath)}`;
  const metadata = `${JSON.stringify({
    schemaVersion: 1,
    taskName: TASK_NAME,
    command: taskCommand,
    environment: options.serviceEnvironment,
  }, null, 2)}\n`;
  return {
    registrationPath,
    async install(): Promise<ServiceInstallResult> {
      const installed = await writeServiceFile(registrationPath, metadata);
      await runServiceCommand(options.run, {
        command: scheduler,
        args: ["/Create", "/TN", TASK_NAME, "/SC", "ONLOGON", "/RL", "LIMITED", "/TR", taskCommand, "/F"],
      });
      return { mode: "service", installed };
    },
    async start(signal?: AbortSignal): Promise<void> {
      // start() is only reached when no daemon answered the control endpoint,
      // but the previous task instance may still be draining after a stop:
      // schtasks /Run is silently ignored while that instance exists, so end
      // it first and let the next boot reclaim the released lock.
      const ended = await options.run(withAbortSignal({ command: scheduler, args: ["/End", "/TN", TASK_NAME] }, signal));
      if (ended.code !== 0 && !isNotRunningTask(ended.stderr)) {
        throw lifecycleError("user_service_command_failed", "The Windows user task could not be stopped");
      }
      await runServiceCommand(options.run, withAbortSignal({ command: scheduler, args: ["/Run", "/TN", TASK_NAME] }, signal));
    },
    async stop(): Promise<void> {
      const result = await options.run({ command: scheduler, args: ["/End", "/TN", TASK_NAME] });
      if (result.code !== 0 && !isNotRunningTask(result.stderr)) {
        throw lifecycleError("user_service_command_failed", "The Windows user task could not be stopped");
      }
    },
    async restart(): Promise<void> {
      await this.stop();
      await this.start();
    },
    async status(): Promise<boolean> {
      const result = await options.run({ command: scheduler, args: ["/Query", "/TN", TASK_NAME, "/FO", "LIST"] });
      return result.code === 0;
    },
    async uninstall(): Promise<void> {
      const result = await options.run({ command: scheduler, args: ["/Delete", "/TN", TASK_NAME, "/F"] });
      if (result.code !== 0 && !/cannot find|does not exist/i.test(result.stderr)) {
        throw lifecycleError("user_service_command_failed", "The Windows user task could not be removed");
      }
      await fs.rm(registrationPath, { force: true });
    },
  };
}

function isNotRunningTask(stderr: string): boolean {
  return /cannot find|does not exist|not currently running/i.test(stderr);
}

export function quoteWindowsArgument(value: string): string {
  if (value.includes("\0") || /[\r\n]/.test(value)) {
    throw lifecycleError("user_service_configuration_invalid", "The Windows service command path is invalid");
  }
  return `"${value.replace(/(\\*)"/g, "$1$1\\\"").replace(/(\\+)$/g, "$1$1")}"`;
}

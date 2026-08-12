import fs from "node:fs/promises";
import path from "node:path";
import { lifecycleError } from "../errors.js";
import type { PlatformServiceOptions, ServiceInstallResult, ServiceManager } from "./service-manager.js";
import { runServiceCommand } from "./service-manager.js";
import { writeServiceFile } from "./service-files.js";

const TASK_NAME = "LocalApp User Daemon";

export function createWindowsUserTask(options: PlatformServiceOptions): Omit<ServiceManager, "logs"> {
  const registrationPath = path.join(options.layout.supportDir, "service", "windows-user-task.json");
  const systemRoot = options.env?.SystemRoot ?? options.env?.SYSTEMROOT ?? "C:\\Windows";
  const scheduler = path.win32.join(systemRoot, "System32", "schtasks.exe");
  const taskCommand = `${quoteWindowsArgument(options.nodePath)} ${quoteWindowsArgument(options.layout.launcherPath)}`;
  const metadata = `${JSON.stringify({ schemaVersion: 1, taskName: TASK_NAME, command: taskCommand }, null, 2)}\n`;
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
    async start(): Promise<void> {
      await runServiceCommand(options.run, { command: scheduler, args: ["/Run", "/TN", TASK_NAME] });
    },
    async stop(): Promise<void> {
      const result = await options.run({ command: scheduler, args: ["/End", "/TN", TASK_NAME] });
      if (result.code !== 0 && !/cannot find|does not exist|not currently running/i.test(result.stderr)) {
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

export function quoteWindowsArgument(value: string): string {
  if (value.includes("\0") || /[\r\n]/.test(value)) {
    throw lifecycleError("user_service_configuration_invalid", "The Windows service command path is invalid");
  }
  return `"${value.replace(/(\\*)"/g, "$1$1\\\"").replace(/(\\+)$/g, "$1$1")}"`;
}

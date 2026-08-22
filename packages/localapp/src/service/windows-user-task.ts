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
      const definitionPath = path.join(path.dirname(registrationPath), "windows-user-task.xml");
      await fs.mkdir(path.dirname(definitionPath), { recursive: true });
      await fs.writeFile(definitionPath, taskDefinition(options.nodePath, options.layout.launcherPath));
      await runServiceCommand(options.run, {
        command: scheduler,
        args: ["/Create", "/TN", TASK_NAME, "/XML", definitionPath, "/F"],
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

/**
 * The daemon must also run while the owning user has no interactive logon
 * session (SSH-only or headless Windows), so the task registers with an S4U
 * logon type instead of the schtasks /TR default, which is interactive-only
 * and silently refuses to start. ExecutionTimeLimit PT0S removes the default
 * 72-hour kill.
 */
function taskDefinition(nodePath: string, launcherPath: string): Buffer {
  // Omitting UserId registers the principal as the creating user, so the
  // definition never depends on ambient account environment variables.
  const xml = `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>LocalApp per-user daemon</Description>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <LogonType>S4U</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${xmlEscape(nodePath)}</Command>
      <Arguments>${xmlEscape(launcherPath)}</Arguments>
    </Exec>
  </Actions>
</Task>
`;
  return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(xml, "utf16le")]);
}

function xmlEscape(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

export function quoteWindowsArgument(value: string): string {
  if (value.includes("\0") || /[\r\n]/.test(value)) {
    throw lifecycleError("user_service_configuration_invalid", "The Windows service command path is invalid");
  }
  return `"${value.replace(/(\\*)"/g, "$1$1\\\"").replace(/(\\+)$/g, "$1$1")}"`;
}

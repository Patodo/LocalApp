import fs from "node:fs/promises";
import path from "node:path";
import { lifecycleError } from "../errors.js";
import type { PlatformServiceOptions, ServiceInstallResult, ServiceManager } from "./service-manager.js";
import { runServiceCommand } from "./service-manager.js";
import { writeServiceFile } from "./service-files.js";

const UNIT_NAME = "localapp.service";

export function createLinuxSystemdUserService(options: PlatformServiceOptions): Omit<ServiceManager, "logs"> {
  const configHome = options.env?.XDG_CONFIG_HOME ?? path.join(options.homeDir, ".config");
  const registrationPath = path.join(configHome, "systemd", "user", UNIT_NAME);
  const unit = buildUnit(options);
  const systemctl = options.env?.SYSTEMCTL_PATH ?? "systemctl";
  return {
    registrationPath,
    async install(): Promise<ServiceInstallResult> {
      const installed = await writeServiceFile(registrationPath, unit);
      const reload = await options.run({ command: systemctl, args: ["--user", "daemon-reload"] }).catch(() => undefined);
      if (reload === undefined || (reload.code !== 0 && /connect to bus|no medium found|not been booted with systemd/i.test(reload.stderr))) {
        return { mode: "foreground", installed: false, reason: "systemd user manager unavailable" };
      }
      if (reload.code !== 0) throw lifecycleError("user_service_command_failed", "The systemd user manager could not reload LocalApp");
      await runServiceCommand(options.run, { command: systemctl, args: ["--user", "enable", "--now", UNIT_NAME] });
      return { mode: "service", installed };
    },
    async start(): Promise<void> {
      await runServiceCommand(options.run, { command: systemctl, args: ["--user", "start", UNIT_NAME] });
    },
    async stop(): Promise<void> {
      const result = await options.run({ command: systemctl, args: ["--user", "stop", UNIT_NAME] });
      if (result.code !== 0 && !isMissingUnit(result.stderr)) {
        throw lifecycleError("user_service_command_failed", "The systemd user service could not be stopped");
      }
    },
    async restart(): Promise<void> {
      await runServiceCommand(options.run, { command: systemctl, args: ["--user", "restart", UNIT_NAME] });
    },
    async status(): Promise<boolean> {
      const result = await options.run({ command: systemctl, args: ["--user", "is-active", "--quiet", UNIT_NAME] });
      if (result.code === 0) return true;
      if ([3, 4].includes(result.code)) return false;
      throw lifecycleError("user_service_command_failed", "The systemd user service status is unavailable");
    },
    async uninstall(): Promise<void> {
      const disabled = await options.run({ command: systemctl, args: ["--user", "disable", "--now", UNIT_NAME] });
      if (disabled.code !== 0 && !isMissingUnit(disabled.stderr)) {
        throw lifecycleError("user_service_command_failed", "The systemd user service could not be removed");
      }
      await fs.rm(registrationPath, { force: true });
      await runServiceCommand(options.run, { command: systemctl, args: ["--user", "daemon-reload"] });
    },
  };
}

function isMissingUnit(stderr: string): boolean {
  return /not loaded|not found|does not exist|no such file/i.test(stderr);
}

function buildUnit(options: PlatformServiceOptions): string {
  const environment = Object.entries(options.serviceEnvironment)
    .map(([key, value]) => `Environment=${systemdQuote(`${key}=${value}`)}`)
    .join("\n");
  return `[Unit]
Description=LocalApp per-user daemon
After=network.target

[Service]
Type=simple
ExecStart=${systemdQuote(options.nodePath)} ${systemdQuote(options.layout.launcherPath)}
Restart=on-failure
RestartSec=2
StandardOutput=append:${systemdQuote(options.layout.daemonLogPath)}
StandardError=append:${systemdQuote(options.layout.daemonLogPath)}
${environment ? `${environment}\n` : ""}
[Install]
WantedBy=default.target
`;
}

export function systemdQuote(value: string): string {
  if (value.includes("\0") || /[\r\n]/.test(value)) {
    throw lifecycleError("user_service_configuration_invalid", "The systemd service command path is invalid");
  }
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("%", "%%").replaceAll("$", "$$")}"`;
}

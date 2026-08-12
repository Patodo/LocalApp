import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { lifecycleError } from "../errors.js";
import type { PlatformServiceOptions, ServiceInstallResult, ServiceManager } from "./service-manager.js";
import { runServiceCommand, withAbortSignal } from "./service-manager.js";
import { writeServiceFile, xmlEscape } from "./service-files.js";

const LABEL = "com.localapp.daemon";

export function createMacosLaunchAgent(options: PlatformServiceOptions): Omit<ServiceManager, "logs"> {
  const uid = options.uid ?? (typeof process.getuid === "function" ? process.getuid() : undefined);
  if (!Number.isSafeInteger(uid) || (uid ?? -1) < 0) {
    throw lifecycleError("user_service_configuration_invalid", "The current macOS user identity is unavailable");
  }
  const registrationPath = path.join(options.homeDir, "Library", "LaunchAgents", `${LABEL}.plist`);
  const domain = `gui/${uid}`;
  const target = `${domain}/${LABEL}`;
  const plist = buildPlist(options);
  const receiptPath = `${registrationPath}.loaded`;
  const plistDigest = crypto.createHash("sha256").update(plist).digest("hex");
  return {
    registrationPath,
    async install(): Promise<ServiceInstallResult> {
      const installed = await writeServiceFile(registrationPath, plist);
      const receipt = await fs.readFile(receiptPath, "utf8").then((value) => value.trim(), () => undefined);
      const loaded = await options.run({ command: "/bin/launchctl", args: ["print", target] });
      if (loaded.code === 0 && receipt === plistDigest) return { mode: "service", installed };
      if (loaded.code !== 0 && !isMissingService(loaded.stderr)) {
        throw lifecycleError("user_service_command_failed", "The macOS LaunchAgent status could not be verified");
      }
      const removed = await options.run({ command: "/bin/launchctl", args: ["bootout", target] });
      if (removed.code !== 0 && !isMissingService(removed.stderr)) {
        throw lifecycleError("user_service_command_failed", "The previous macOS LaunchAgent could not be removed");
      }
      const result = await options.run({ command: "/bin/launchctl", args: ["bootstrap", domain, registrationPath] });
      if (result.code !== 0) {
        throw lifecycleError("user_service_command_failed", "The macOS LaunchAgent could not be registered");
      }
      await writeServiceFile(receiptPath, `${plistDigest}\n`);
      return { mode: "service", installed };
    },
    async start(signal?: AbortSignal): Promise<void> {
      const loaded = await options.run(withAbortSignal({ command: "/bin/launchctl", args: ["print", target] }, signal));
      if (loaded.code !== 0) {
        const result = await options.run(withAbortSignal({ command: "/bin/launchctl", args: ["bootstrap", domain, registrationPath] }, signal));
        if (result.code !== 0) throw lifecycleError("user_service_command_failed", "The macOS LaunchAgent could not be registered");
      }
      await runServiceCommand(options.run, withAbortSignal({ command: "/bin/launchctl", args: ["kickstart", "-k", target] }, signal));
    },
    async stop(): Promise<void> {
      const result = await options.run({ command: "/bin/launchctl", args: ["bootout", domain, registrationPath] });
      if (result.code !== 0 && !/could not find service|no such process/i.test(result.stderr)) {
        throw lifecycleError("user_service_command_failed", "The macOS LaunchAgent could not be stopped");
      }
    },
    async restart(): Promise<void> {
      await runServiceCommand(options.run, { command: "/bin/launchctl", args: ["kickstart", "-k", target] });
    },
    async status(): Promise<boolean> {
      const result = await options.run({ command: "/bin/launchctl", args: ["print", target] });
      return result.code === 0;
    },
    async uninstall(): Promise<void> {
      const result = await options.run({ command: "/bin/launchctl", args: ["bootout", domain, registrationPath] });
      if (result.code !== 0 && !/could not find service|no such process/i.test(result.stderr)) {
        throw lifecycleError("user_service_command_failed", "The macOS LaunchAgent could not be removed");
      }
      await fs.rm(registrationPath, { force: true });
      await fs.rm(receiptPath, { force: true });
    },
  };
}

function isMissingService(stderr: string): boolean {
  return /could not find service|service (?:is )?not found|no such process/i.test(stderr);
}

function buildPlist(options: PlatformServiceOptions): string {
  const environment = Object.entries(options.serviceEnvironment).map(([key, value]) =>
    `      <key>${xmlEscape(key)}</key>\n      <string>${xmlEscape(value)}</string>`,
  ).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xmlEscape(options.nodePath)}</string>
    <string>${xmlEscape(options.layout.launcherPath)}</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Interactive</string>
  <key>StandardOutPath</key><string>${xmlEscape(options.layout.daemonLogPath)}</string>
  <key>StandardErrorPath</key><string>${xmlEscape(options.layout.daemonLogPath)}</string>
${environment ? `  <key>EnvironmentVariables</key>\n  <dict>\n${environment}\n  </dict>\n` : ""}</dict>
</plist>
`;
}

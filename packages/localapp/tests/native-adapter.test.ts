import { EventEmitter } from "node:events";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildLinuxDesktopEntry,
  buildWindowsSchemeRegistration,
  createWindowsProcessTreeAdapter,
  createWindowsSchemeRegistrationInvocation,
  createWindowsSchemeForwardInvocation,
  installLinuxScheme,
  performWindowsAtomicOwnership,
  validateNativeNotificationEnvelope,
} from "../src/native/native-adapter.js";

const fixtureDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(fixtureDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("native adapter boundary", () => {
  it("bounds the native notification envelope and excludes arbitrary destinations", () => {
    expect(validateNativeNotificationEnvelope({
      ticket: "notification_ticket_0123456789", title: "Build complete", body: "The task finished", sourceLabel: "Local server", priority: "normal", iconPath: "/safe/icon.png",
    })).toEqual({
      ticket: "notification_ticket_0123456789", title: "Build complete", body: "The task finished", sourceLabel: "Local server", priority: "normal", iconPath: "/safe/icon.png",
    });
    expect(() => validateNativeNotificationEnvelope({
      ticket: "notification_ticket_0123456789", title: "x".repeat(9_000), body: "body", sourceLabel: "source", priority: "normal", iconPath: "/safe/icon.png", url: "https://evil.example",
    })).toThrow(/NATIVE_NOTIFICATION_INVALID/);
    for (const iconPath of ["file:///safe/icon.png", "relative/icon.png", "/safe/../icon.png", "/safe/\0icon.png"]) {
      expect(() => validateNativeNotificationEnvelope({
        ticket: "notification_ticket_0123456789", title: "Build complete", body: "The task finished", sourceLabel: "Local server", priority: "normal", iconPath,
      })).toThrow(/NATIVE_NOTIFICATION_INVALID/);
    }
  });

  it("generates a Linux %u handler with desktop-entry escaping and no shell interpolation", () => {
    const desktop = buildLinuxDesktopEntry("/opt/Local App/node$`runtime", "/opt/Local App/client\\with\\\"quote%.mjs");
    expect(desktop).toContain('Exec="/opt/Local App/node\\$\\`runtime" "/opt/Local App/client\\\\with\\\\\\"quote%%.mjs" %u');
    expect(desktop).toContain("MimeType=x-scheme-handler/localapp;");
    expect(desktop).not.toContain("sh -c");
    expect(desktop).not.toContain("$()");
  });

  it("installs only an idempotent per-user Linux desktop entry and MIME association", async () => {
    const dataHome = await fs.mkdtemp(path.resolve(process.cwd(), "../../tmp/task-8-linux-install-"));
    fixtureDirectories.push(dataHome);
    const calls: Array<{ command: string; args: readonly string[] }> = [];
    const options = {
      nodePath: "/opt/Local App/node",
      ipcClientPath: "/opt/Local App/runtime/native/linux-x64/localapp-native-ipc-client.mjs",
      dataHome,
      run: async (command: string, args: readonly string[]) => { calls.push({ command, args }); return ""; },
    };
    await installLinuxScheme(options);
    const desktopPath = path.join(dataHome, "applications", "localapp.desktop");
    const first = await fs.readFile(desktopPath, "utf8");
    await installLinuxScheme(options);

    expect(first).toBe(await fs.readFile(desktopPath, "utf8"));
    expect(calls).toEqual([
      { command: "xdg-mime", args: ["default", "localapp.desktop", "x-scheme-handler/localapp"] },
      { command: "xdg-mime", args: ["default", "localapp.desktop", "x-scheme-handler/localapp"] },
    ]);
  });

  it("uses only HKCU and forwards the complete URI to the packaged Windows bridge", async () => {
    const executable = "C:\\Program Files\\Local App\\localapp-native.exe";
    const configPath = "C:\\Users\\Pat\\AppData\\Local\\LocalApp\\native-bridge.json";
    const registrations = buildWindowsSchemeRegistration(executable, configPath);
    expect(registrations.every((entry) => entry.key.startsWith("HKCU\\"))).toBe(true);
    expect(registrations.map((entry) => entry.value).join("\n")).toContain('"C:\\Program Files\\Local App\\localapp-native.exe" --scheme --config "C:\\Users\\Pat\\AppData\\Local\\LocalApp\\native-bridge.json" "%1"');
    expect(registrations.map((entry) => entry.key).join("\n")).not.toContain("AppNotification");
    expect(createWindowsSchemeForwardInvocation(executable, configPath, "localapp://notification/open?ticket=notification_ticket_0123456789"))
      .toEqual({ command: executable, args: ["--scheme", "--config", configPath, "localapp://notification/open?ticket=notification_ticket_0123456789"] });
    expect(createWindowsSchemeRegistrationInvocation(executable, configPath))
      .toEqual({ command: executable, args: ["--register", "--config", configPath] });
  });

  it("rejects a multibyte Scheme URL over 4096 UTF-8 bytes before Windows forwarding", () => {
    const executable = "C:\\Program Files\\Local App\\localapp-native.exe";
    const configPath = "C:\\Users\\Pat\\AppData\\Local\\LocalApp\\native-bridge.json";
    const oversizedUrl = `localapp://notification/open?ticket=${"界".repeat(1_400)}`;
    expect(Buffer.byteLength(oversizedUrl, "utf8")).toBeGreaterThan(4_096);

    expect(() => createWindowsSchemeForwardInvocation(executable, configPath, oversizedUrl))
      .toThrow(/activation.*invalid|Scheme forwarding arguments are invalid/i);
  });

  it("creates suspended, assigns a kill-on-close Job Object, then resumes in order", () => {
    const steps: string[] = [];
    const process = { terminate: () => steps.push("terminate") };
    const job = { close: () => steps.push("close") };
    performWindowsAtomicOwnership({
      createSuspended: () => { steps.push("suspended"); return process; },
      createKillOnCloseJob: () => { steps.push("job"); return job; },
      assignToJob: () => steps.push("assign"),
      resume: () => steps.push("resume"),
    });
    expect(steps).toEqual(["suspended", "job", "assign", "resume"]);
  });

  it("terminates the suspended root and closes partial Job ownership after every setup failure", () => {
    for (const failedAt of ["job", "assign", "resume"] as const) {
      const steps: string[] = [];
      expect(() => performWindowsAtomicOwnership({
        createSuspended: () => ({ terminate: () => steps.push("terminate") }),
        createKillOnCloseJob: () => {
          if (failedAt === "job") throw new Error("job");
          return { close: () => steps.push("close") };
        },
        assignToJob: () => { if (failedAt === "assign") throw new Error("assign"); },
        resume: () => { if (failedAt === "resume") throw new Error("resume"); },
      })).toThrow();
      expect(steps).toContain("terminate");
      if (failedAt !== "job") expect(steps).toContain("close");
    }
  });

  it("provides Task 6 a WindowsProcessTreeAdapter once an atomic native helper is present", () => {
    const child = fakeChild(91_001);
    const adapter = createWindowsProcessTreeAdapter({
      spawn: () => ({ child, treeExists: () => false, signalTree: () => undefined }),
    });
    expect(adapter.spawnOwned("node", ["server"], { stdio: "ignore" }).child.pid).toBe(91_001);
  });
});

function fakeChild(pid: number): ChildProcess {
  const child = new EventEmitter() as ChildProcess;
  Object.assign(child, { pid, exitCode: 0, signalCode: null, kill: () => true });
  return child;
}

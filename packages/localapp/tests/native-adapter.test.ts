import { EventEmitter } from "node:events";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  buildLinuxDesktopEntry,
  buildWindowsSchemeRegistration,
  createWindowsProcessTreeAdapter,
  performWindowsAtomicOwnership,
  validateNativeNotificationEnvelope,
} from "../src/native/native-adapter.js";

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
  });

  it("generates a Linux %u handler without shell interpolation", () => {
    const desktop = buildLinuxDesktopEntry("/opt/Local App/bin/localapp-native-ipc-client");
    expect(desktop).toContain("Exec=/opt/Local\\ App/bin/localapp-native-ipc-client %u");
    expect(desktop).toContain("MimeType=x-scheme-handler/localapp;");
    expect(desktop).not.toContain("sh -c");
    expect(desktop).not.toContain("$()");
  });

  it("uses only HKCU and safely quotes the Windows URI and App Notification activator", () => {
    const registrations = buildWindowsSchemeRegistration("C:\\Program Files\\Local App\\localapp-native.exe");
    expect(registrations.every((entry) => entry.key.startsWith("HKCU\\"))).toBe(true);
    expect(registrations.map((entry) => entry.value).join("\n")).toContain('"C:\\Program Files\\Local App\\localapp-native.exe" "%1"');
    expect(registrations.map((entry) => entry.key).join("\n")).toContain("AppNotification");
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

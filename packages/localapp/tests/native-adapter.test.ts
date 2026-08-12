import { EventEmitter } from "node:events";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildLinuxDesktopEntry,
  buildWindowsSchemeRegistration,
  createNativeAdapter,
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
      identifier: "notification_native_0123456789", ticket: "notification_ticket_0123456789", productLabel: "LocalApp", applicationLabel: "Interview App", title: "Build complete", body: "The task finished", sourceLabel: "Local server", priority: "normal", iconPath: "/safe/icon.png",
    })).toEqual({
      identifier: "notification_native_0123456789", ticket: "notification_ticket_0123456789", productLabel: "LocalApp", applicationLabel: "Interview App", title: "Build complete", body: "The task finished", sourceLabel: "Local server", priority: "normal", iconPath: "/safe/icon.png",
    });
    expect(() => validateNativeNotificationEnvelope({
      identifier: "notification_native_0123456789", ticket: "notification_ticket_0123456789", productLabel: "LocalApp", applicationLabel: "Interview App", title: "x".repeat(9_000), body: "body", sourceLabel: "source", priority: "normal", iconPath: "/safe/icon.png", url: "https://evil.example",
    })).toThrow(/NATIVE_NOTIFICATION_INVALID/);
    for (const iconPath of ["file:///safe/icon.png", "relative/icon.png", "/safe/../icon.png", "/safe/\0icon.png"]) {
      expect(() => validateNativeNotificationEnvelope({
        identifier: "notification_native_0123456789", ticket: "notification_ticket_0123456789", productLabel: "LocalApp", applicationLabel: "Interview App", title: "Build complete", body: "The task finished", sourceLabel: "Local server", priority: "normal", iconPath,
      })).toThrow(/NATIVE_NOTIFICATION_INVALID/);
    }
    for (const unsafeText of ["hello\0world", "hello\nworld", "<img src=https://evil.example/x>"]) {
      expect(() => validateNativeNotificationEnvelope({
        identifier: "notification_native_0123456789", ticket: "notification_ticket_0123456789", productLabel: "LocalApp", applicationLabel: "Interview App", title: unsafeText, body: "body", sourceLabel: "source", priority: "normal", iconPath: "/safe/icon.png",
      })).toThrow(/NATIVE_NOTIFICATION_INVALID/);
    }
  });

  it("bounds an explicit macOS permission request and never requests in the background", async () => {
    const fixture = await nativeFixture("darwin");
    const calls: string[][] = [];
    const adapter = await createNativeAdapter(fixture.root, {
      platform: "darwin",
      arch: "arm64",
      supportDir: fixture.support,
      permissionTimeoutMs: 25,
      run: async (_command, args) => {
        calls.push([...args]);
        if (args[0] === "--request-permission") {
          await new Promise((resolve) => setTimeout(resolve, 80));
          return "granted";
        }
        return "not-determined";
      },
    } as never);

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(calls).toEqual([]);
    await expect(adapter.permissionState()).resolves.toBe("not-determined");
    await expect(adapter.requestPermission()).rejects.toThrow(/NATIVE_ADAPTER_TIMEOUT/);
    expect(calls).toEqual([["--permission-state"], ["--request-permission"]]);
  });

  it("validates a regular local icon before macOS display and preserves stable replacement argv", async () => {
    const fixture = await nativeFixture("darwin");
    const icon = path.join(fixture.root, "icon.png");
    await fs.writeFile(icon, "png");
    const calls: string[][] = [];
    const adapter = await createNativeAdapter(fixture.root, {
      platform: "darwin", arch: "arm64", supportDir: fixture.support,
      run: async (_command, args) => { calls.push([...args]); return ""; },
    });
    const envelope = notificationEnvelope(icon);
    await adapter.showNotification(envelope);
    await adapter.showNotification(envelope);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual(calls[1]);
    expect(calls[0]?.[0]).toBe("--show-notification");

    const missing = notificationEnvelope(path.join(fixture.root, "missing.png"));
    await expect(adapter.showNotification(missing)).rejects.toThrow(/NATIVE_NOTIFICATION_INVALID/);
    expect(calls).toHaveLength(2);
  });

  it("uses the Windows current-user notification helper and reports missing runtime support", async () => {
    const fixture = await nativeFixture("win32");
    const icon = path.win32.join("C:\\Users\\Pat\\AppData\\Local\\LocalApp", "icon.png");
    const calls: string[][] = [];
    const adapter = await createNativeAdapter(fixture.root, {
      platform: "win32", arch: "x64", supportDir: "C:\\Users\\Pat\\AppData\\Local\\LocalApp",
      verifyIcon: async () => true,
      run: async (_command, args) => {
        calls.push([...args]);
        if (args[0] === "--permission-state") return "unsupported";
        if (args[0] === "--request-permission") return "unsupported";
        return "";
      },
    } as never);

    await expect(adapter.permissionState()).resolves.toBe("unsupported");
    await expect(adapter.requestPermission()).resolves.toBe("unsupported");
    await expect(adapter.showNotification(notificationEnvelope(icon))).resolves.toBeUndefined();
    expect(calls.map((args) => args[0])).toEqual(["--permission-state", "--request-permission", "--show-notification"]);
    expect(calls[2]?.[1]).toContain('"ticket":"notification_ticket_0123456789"');
  });

  it("uses one strict Linux action URL and cleans up the owned D-Bus session exactly once", async () => {
    const fixture = await nativeFixture("linux");
    const icon = path.join(fixture.root, "icon.png");
    await fs.writeFile(icon, "png");
    const shown: Array<{ envelope: unknown; activationUrl: string }> = [];
    let shutdowns = 0;
    const linuxNotifications = {
      permissionState: async () => "granted",
      requestPermission: async () => "granted",
      showNotification: async (envelope: unknown, activationUrl: string) => { shown.push({ envelope, activationUrl }); return { actions: true }; },
      shutdown: async () => { shutdowns += 1; },
    };
    const adapter = await createNativeAdapter(fixture.root, {
      platform: "linux", arch: "x64", dataHome: fixture.data,
      linuxNotifications,
    } as never);

    await expect(adapter.permissionState()).resolves.toBe("granted");
    await adapter.showNotification(notificationEnvelope(icon));
    expect(shown).toEqual([{ envelope: notificationEnvelope(icon), activationUrl: "localapp://notification/open?ticket=notification_ticket_0123456789" }]);
    expect(typeof (adapter as { shutdown?: unknown }).shutdown).toBe("function");
    await (adapter as { shutdown(): Promise<void> }).shutdown();
    await (adapter as { shutdown(): Promise<void> }).shutdown();
    expect(shutdowns).toBe(1);
  });

  it("starts the packaged Linux D-Bus helper without a shell and shuts down its action listener", async () => {
    const fixture = await nativeFixture("linux");
    const icon = path.join(fixture.root, "icon.png");
    const capture = path.join(fixture.root, "linux-helper.jsonl");
    await fs.writeFile(icon, "png");
    const adapter = await createNativeAdapter(fixture.root, {
      platform: "linux",
      arch: "x64",
      nodePath: process.execPath,
      env: { ...process.env, LOCALAPP_NATIVE_TEST_CAPTURE: capture },
      commandTimeoutMs: 1_000,
    });

    await expect(adapter.permissionState()).resolves.toBe("granted");
    await adapter.showNotification(notificationEnvelope(icon));
    const captured = JSON.parse((await fs.readFile(capture, "utf8")).trim()) as { pid: number; args: string[] };
    expect(captured.args[0]).toBe("--show-notification");
    expect(JSON.parse(captured.args[1]!)).toEqual(notificationEnvelope(icon));
    expect(captured.args).toContain("--ipc-client");
    expect(captured.args).toContain("--replace-id");
    expect(() => process.kill(captured.pid, 0)).not.toThrow();
    await adapter.shutdown();
    await waitForProcessExit(captured.pid);
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

function notificationEnvelope(iconPath: string) {
  return {
    identifier: "notification_native_0123456789",
    ticket: "notification_ticket_0123456789",
    productLabel: "LocalApp",
    applicationLabel: "Interview App",
    title: "Build complete",
    body: "The task finished",
    sourceLabel: "Local server",
    priority: "normal" as const,
    iconPath,
  };
}

async function nativeFixture(platform: "darwin" | "win32" | "linux") {
  const root = await fs.mkdtemp(path.resolve(process.cwd(), "../../tmp/task-11-native-adapter-"));
  fixtureDirectories.push(root);
  const target = `${platform}-${platform === "darwin" ? "arm64" : "x64"}`;
  const executableRelative = platform === "darwin"
    ? `${target}/LocalAppBridge.app/Contents/MacOS/LocalAppBridge`
    : platform === "win32" ? `${target}/localapp-native.exe` : `${target}/localapp-native-ipc-client.mjs`;
  const ipcRelative = platform === "darwin"
    ? `${target}/LocalAppBridge.app/Contents/Resources/localapp-native-ipc-client.mjs`
    : `${target}/localapp-native-ipc-client.mjs`;
  const assets = [...new Set([executableRelative, ipcRelative])];
  if (platform === "linux") assets.push(`${target}/localapp-notifications`);
  for (const relative of assets) {
    const absolute = path.join(root, ...relative.split("/"));
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    const helper = relative.endsWith("/localapp-notifications")
      ? `#!/usr/bin/env node\nimport fs from "node:fs";\nconst args = process.argv.slice(2);\nif (args[0] === "--permission-state" || args[0] === "--request-permission") { console.log("granted"); process.exit(0); }\nfs.appendFileSync(process.env.LOCALAPP_NATIVE_TEST_CAPTURE, JSON.stringify({ pid: process.pid, args }) + "\\n");\nconsole.log('{"accepted":true,"actions":true,"notificationId":17}');\nsetInterval(() => {}, 1000);\n`
      : relative;
    await fs.writeFile(absolute, helper);
    await fs.chmod(absolute, 0o755);
  }
  await fs.writeFile(path.join(root, "adapter-manifest.json"), `${JSON.stringify({
    schemaVersion: 1,
    target,
    signing: { mode: "adhoc" },
    assets: await Promise.all(assets.map(async (relative) => ({
      path: relative,
      sha256: crypto.createHash("sha256").update(await fs.readFile(path.join(root, ...relative.split("/")))).digest("hex"),
    }))),
  })}\n`);
  return { root, support: path.join(root, "support"), data: path.join(root, "data") };
}

async function waitForProcessExit(pid: number) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    try { process.kill(pid, 0); } catch { return; }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Linux helper ${pid} did not exit`);
}

import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createRuntimeLayout } from "../src/daemon/runtime-layout.js";
import {
  createServiceManager,
  runtimeLayoutServiceEnvironment,
  type ServiceCommandInvocation,
  type ServiceCommandResult,
} from "../src/service/service-manager.js";

const repositoryRoot = path.resolve(process.cwd(), "../..");
const testRoot = path.join(repositoryRoot, "tmp/task-7-service-tests");
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("per-user service manager", () => {
  it("persists only the explicit runtime layout needed by a user service", async () => {
    const fixture = await serviceFixture("runtime environment");
    expect(runtimeLayoutServiceEnvironment(fixture.layout)).toEqual({
      LOCALAPP_SUPPORT_DIR: fixture.layout.supportDir,
      LOCALAPP_RUNTIME_DIR: fixture.layout.runtimeDir,
      LOCALAPP_DATA_DIR: fixture.layout.dataDir,
    });
  });

  it("writes an escaped LaunchAgent and registers only the current GUI user", async () => {
    const fixture = await serviceFixture("mac & user <one>");
    const commands: ServiceCommandInvocation[] = [];
    const manager = createServiceManager({
      platform: "darwin",
      layout: fixture.layout,
      nodePath: "/Node Runtime/bin/node",
      uid: 501,
      homeDir: fixture.root,
      run: recordingRunner(commands),
    });

    await expect(manager.install()).resolves.toEqual({ mode: "service", installed: true });
    const registration = manager.registrationPath;
    const plist = await fs.readFile(registration, "utf8");
    expect(plist).toContain("/Node Runtime/bin/node");
    expect(plist).toContain(fixture.layout.launcherPath.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"));
    expect(plist).not.toMatch(/api.?key|password|secret/i);
    expect(commands).toContainEqual(expect.objectContaining({
      command: "/bin/launchctl",
      args: ["bootstrap", "gui/501", registration],
    }));
    expect(commands.flatMap((command) => command.args).join(" ")).not.toContain("system/");
  });

  it("reloads a changed LaunchAgent and leaves an unchanged loaded registration alone", async () => {
    const fixture = await serviceFixture("mac reload");
    const commands: ServiceCommandInvocation[] = [];
    const manager = createServiceManager({
      platform: "darwin",
      layout: fixture.layout,
      nodePath: "/Node Runtime/bin/node",
      uid: 501,
      homeDir: fixture.root,
      run: recordingRunner(commands, (invocation) => invocation.args[0] === "print"
        ? { code: 0, stdout: "loaded", stderr: "" }
        : undefined),
    });

    await manager.install();
    const firstBootoutCount = commands.filter((command) => command.args[0] === "bootout").length;
    const firstBootstrapCount = commands.filter((command) => command.args[0] === "bootstrap").length;
    expect(firstBootoutCount).toBe(1);
    expect(firstBootstrapCount).toBe(1);

    await manager.install();
    expect(commands.filter((command) => command.args[0] === "bootout")).toHaveLength(firstBootoutCount);
    expect(commands.filter((command) => command.args[0] === "bootstrap")).toHaveLength(firstBootstrapCount);
  });

  it("boots out on explicit macOS stop and bootstraps again on later start", async () => {
    const fixture = await serviceFixture("mac explicit stop");
    const commands: ServiceCommandInvocation[] = [];
    let loaded = false;
    const manager = createServiceManager({
      platform: "darwin", layout: fixture.layout, nodePath: process.execPath, uid: 501, homeDir: fixture.root,
      run: recordingRunner(commands, (invocation) => {
        if (invocation.args[0] === "print") return { code: loaded ? 0 : 1, stdout: "", stderr: "Could not find service" };
        if (invocation.args[0] === "bootstrap") { loaded = true; return { code: 0, stdout: "", stderr: "" }; }
        if (invocation.args[0] === "bootout") { loaded = false; return { code: 0, stdout: "", stderr: "" }; }
        return undefined;
      }),
    });
    await manager.install();
    await manager.stop();
    expect(await manager.status()).toBe(false);
    await manager.start();
    expect(await manager.status()).toBe(true);
    expect(commands.filter((command) => command.args[0] === "bootstrap")).toHaveLength(2);
    await expect(fs.stat(manager.registrationPath)).resolves.toMatchObject({ isFile: expect.any(Function) });
  });

  it("creates a LIMITED current-user Windows task with one safely quoted command", async () => {
    const fixture = await serviceFixture("windows & task (one)!");
    const commands: ServiceCommandInvocation[] = [];
    const manager = createServiceManager({
      platform: "win32",
      layout: fixture.layout,
      nodePath: "C:\\Program Files\\Node & Runtime\\node.exe",
      homeDir: fixture.root,
      serviceEnvironment: runtimeLayoutServiceEnvironment(fixture.layout),
      run: recordingRunner(commands),
    });

    await manager.install();
    const create = commands.find((command) => command.args.includes("/Create"));
    expect(create?.command.toLowerCase()).toMatch(/schtasks\.exe$/);
    expect(create?.args).toContain("LIMITED");
    expect(create?.args).not.toContain("SYSTEM");
    const taskCommand = create?.args[create.args.indexOf("/TR") + 1] ?? "";
    expect(taskCommand).toContain('"C:\\Program Files\\Node & Runtime\\node.exe"');
    expect(taskCommand).toContain('"' + fixture.layout.launcherPath + '"');
    expect(taskCommand).not.toMatch(/api.?key|password|secret/i);
    const metadata = JSON.parse(await fs.readFile(manager.registrationPath, "utf8"));
    expect(metadata.environment).toEqual({
      LOCALAPP_SUPPORT_DIR: fixture.layout.supportDir,
      LOCALAPP_RUNTIME_DIR: fixture.layout.runtimeDir,
      LOCALAPP_DATA_DIR: fixture.layout.dataDir,
    });
  });

  it("writes a systemd --user unit and reports an explicit foreground fallback", async () => {
    const fixture = await serviceFixture("linux service with spaces");
    const commands: ServiceCommandInvocation[] = [];
    const manager = createServiceManager({
      platform: "linux",
      layout: fixture.layout,
      nodePath: "/opt/Node Runtime/bin/node",
      homeDir: fixture.root,
      env: { XDG_CONFIG_HOME: path.join(fixture.root, "config home") },
      run: recordingRunner(commands, (invocation) => invocation.args.includes("daemon-reload")
        ? { code: 1, stdout: "", stderr: "Failed to connect to bus" }
        : undefined),
    });

    await expect(manager.install()).resolves.toMatchObject({ mode: "foreground", installed: false });
    const unit = await fs.readFile(manager.registrationPath, "utf8");
    expect(unit).toContain("ExecStart=\"");
    expect(unit).toContain("/opt/Node Runtime/bin/node");
    expect(commands.every((command) => command.args[0] === "--user")).toBe(true);
  });

  it.each([
    { name: "macOS LaunchAgent", platform: "darwin" as const, uid: 501 },
    { name: "Linux systemd user unit", platform: "linux" as const },
    { name: "Windows current-user task", platform: "win32" as const },
  ])("passes the abort signal to every $name start command", async ({ platform, uid }) => {
    const fixture = await serviceFixture(`${platform} abort propagation`);
    const commands: ServiceCommandInvocation[] = [];
    const manager = createServiceManager({
      platform,
      layout: fixture.layout,
      nodePath: process.execPath,
      homeDir: fixture.root,
      ...(uid === undefined ? {} : { uid }),
      run: recordingRunner(commands),
    });
    const controller = new AbortController();

    await manager.start(controller.signal);

    expect(commands.length).toBeGreaterThan(0);
    expect(commands.every((command) => command.signal === controller.signal)).toBe(true);
  });

  it("does not delete a systemd unit when disable fails for a real error", async () => {
    const fixture = await serviceFixture("linux uninstall failure");
    const manager = createServiceManager({
      platform: "linux",
      layout: fixture.layout,
      nodePath: process.execPath,
      homeDir: fixture.root,
      env: { XDG_CONFIG_HOME: path.join(fixture.root, "config") },
      run: recordingRunner([], (invocation) => invocation.args.includes("disable")
        ? { code: 1, stdout: "", stderr: "Access denied" }
        : undefined),
    });
    await manager.install();

    await expect(manager.uninstall()).rejects.toMatchObject({ code: "user_service_command_failed" });
    await expect(fs.stat(manager.registrationPath)).resolves.toMatchObject({ isFile: expect.any(Function) });
  });

  it("rejects secret-bearing service environments before writing registration", async () => {
    const fixture = await serviceFixture("secret rejection");
    expect(() => createServiceManager({
        platform: "darwin",
        layout: fixture.layout,
        nodePath: process.execPath,
        uid: 501,
        homeDir: fixture.root,
        serviceEnvironment: { LOCALAPP_API_KEY: "do-not-persist" },
        run: recordingRunner([]),
      })).toThrow(expect.objectContaining({ code: "user_service_configuration_invalid" }));
    await expect(fs.stat(path.join(fixture.root, "Library/LaunchAgents/com.localapp.daemon.plist")))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("reads only a bounded tail from a multi-megabyte daemon log", async () => {
    const fixture = await serviceFixture("bounded logs");
    const manager = createServiceManager({ platform: "linux", layout: fixture.layout, nodePath: process.execPath, homeDir: fixture.root, run: recordingRunner([]) });
    await fs.mkdir(path.dirname(fixture.layout.daemonLogPath), { recursive: true });
    await fs.writeFile(fixture.layout.daemonLogPath, `BEGIN-OF-LOG\n${"old-line\n".repeat(400_000)}final-line\n`);
    const logs = await manager.logs(2);
    expect(logs).toContain("[truncated to 1048576 bytes]");
    expect(logs).toContain("final-line");
    expect(logs).not.toContain("BEGIN-OF-LOG");
  });
});

async function serviceFixture(name: string) {
  await fs.mkdir(testRoot, { recursive: true });
  const root = await fs.mkdtemp(path.join(testRoot, "fixture-"));
  directories.push(root);
  const supportDir = path.join(root, name, "support");
  const layout = createRuntimeLayout({
    platform: process.platform,
    homeDir: root,
    supportDir,
    runtimeDir: path.join(root, name, "runtime"),
  });
  await fs.mkdir(path.dirname(layout.launcherPath), { recursive: true });
  await fs.writeFile(layout.launcherPath, "// launcher\n");
  return { root, layout };
}

function recordingRunner(
  commands: ServiceCommandInvocation[],
  override?: (invocation: ServiceCommandInvocation) => ServiceCommandResult | undefined,
) {
  return async (invocation: ServiceCommandInvocation): Promise<ServiceCommandResult> => {
    commands.push(invocation);
    return override?.(invocation) ?? { code: 0, stdout: "", stderr: "" };
  };
}

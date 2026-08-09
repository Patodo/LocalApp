import { afterEach, describe, expect, it } from "vitest";
import { once } from "node:events";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AgentRunner } from "../src/lib/agent-runner.js";
import { closeMetaDb, initMetaDb } from "../src/lib/meta-sqlite.js";
import { ProcessTreeController } from "../src/lib/process-tree.js";
import { findExecutable, TaskRunner } from "../src/lib/task-runner.js";
import { TaskStore } from "../src/lib/task-store.js";
import { WorkspaceStore } from "../src/lib/workspace-store.js";

const roots: string[] = [];

afterEach(() => {
  closeMetaDb();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("process tree lifecycle", () => {
  it("uses taskkill tree mode with bounded force escalation on Windows", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const controller = new ProcessTreeController({
      platform: "win32",
      runCommand: async (command, args) => {
        calls.push({ command, args });
        return { code: 0, stdout: "", stderr: "" };
      },
    });

    await controller.signalTree(321, false);
    await controller.signalTree(321, true);

    expect(calls).toEqual([
      { command: "taskkill", args: ["/PID", "321", "/T"] },
      { command: "taskkill", args: ["/PID", "321", "/T", "/F"] },
    ]);
  });

  it("escalates from graceful to forced tree termination when a process remains alive", async () => {
    const signals: boolean[] = [];
    let alive = true;
    const controller = new ProcessTreeController({
      signalTree: async (_pid, force) => {
        signals.push(force);
        if (force) alive = false;
      },
      isAlive: () => alive,
    });

    await controller.terminateAndWait(654, 1);

    expect(signals).toEqual([false, true]);
  });

  it("forces Windows tree termination when graceful taskkill fails while the PID remains alive", async () => {
    const calls: string[][] = [];
    let alive = true;
    const controller = new ProcessTreeController({
      platform: "win32",
      isAlive: () => alive,
      runCommand: async (_command, args) => {
        calls.push(args);
        if (!args.includes("/F")) return { code: 1, stdout: "", stderr: "graceful failure" };
        alive = false;
        return { code: 0, stdout: "", stderr: "" };
      },
    });

    await controller.terminateAndWait(777, 1);

    expect(calls).toEqual([
      ["/PID", "777", "/T"],
      ["/PID", "777", "/T", "/F"],
    ]);
    expect(alive).toBe(false);
  });

  it("kills and reaps a matching retained process tree before interrupting its task", async () => {
    const fixture = await taskFixture();
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      detached: process.platform !== "win32",
      stdio: "ignore",
    });
    const closed = once(child, "close");
    await once(child, "spawn");
    const controller = new ProcessTreeController();
    const identity = await controller.processIdentity(child.pid!);
    const task = fixture.store.create({
      workspaceId: fixture.workspace.id,
      kind: "test",
      executable: "node",
      args: ["-e", "setInterval(() => {}, 1000)"],
      timeoutMs: 10_000,
      requestedBy: "owner",
      outputPath: path.join(fixture.root, "retained.log"),
      status: "running",
      pid: child.pid,
      processIdentity: identity,
    });
    const runner = new TaskRunner({
      workspaceStore: fixture.workspaces,
      taskStore: fixture.store,
      taskDir: path.join(fixture.root, "tasks"),
      authorizeExecution: () => true,
      processController: controller,
    });

    await runner.reconcileRunning();

    expect(fixture.store.get(task.id)?.status).toBe("interrupted");
    await expectProcessGone(child.pid!);
    await closed;
  });

  it("does not signal a reused PID whose process identity differs", async () => {
    const fixture = await taskFixture();
    const signalled: number[] = [];
    const controller = new ProcessTreeController({
      processIdentity: async () => "different-live-process",
      signalTree: async (pid) => { signalled.push(pid); },
      isAlive: () => true,
    });
    const task = fixture.store.create({
      workspaceId: fixture.workspace.id,
      kind: "test",
      executable: "node",
      args: [],
      timeoutMs: 10_000,
      requestedBy: "owner",
      outputPath: path.join(fixture.root, "reused.log"),
      status: "running",
      pid: process.pid,
      processIdentity: "recorded-old-process",
    });
    const runner = new TaskRunner({
      workspaceStore: fixture.workspaces,
      taskStore: fixture.store,
      taskDir: path.join(fixture.root, "tasks"),
      authorizeExecution: () => true,
      processController: controller,
    });

    await runner.reconcileRunning();

    expect(signalled).toEqual([]);
    expect(fixture.store.get(task.id)?.status).toBe("interrupted");
  });

  it("runs tasks through the Server-owned identity-token supervisor", async () => {
    const fixture = await taskFixture();
    const runner = new TaskRunner({
      workspaceStore: fixture.workspaces,
      taskStore: fixture.store,
      taskDir: path.join(fixture.root, "tasks"),
      authorizeExecution: () => true,
    });
    const task = await runner.start({
      workspaceId: fixture.workspace.id,
      kind: "test",
      executable: "node",
      args: ["-e", "setInterval(() => {}, 1000)"],
      timeoutMs: 2_000,
      requestedBy: "owner",
    });

    expect(task.processIdentity).toContain("task-supervisor.mjs");
    await runner.cancel(task.id);
  });

  it("never launches task code when durable identity persistence fails before start authorization", async () => {
    const fixture = await taskFixture();
    const marker = path.join(fixture.root, "task-body-ran");
    const workspacePath = fixture.workspaces.pathFor(fixture.workspace.id);
    fs.writeFileSync(path.join(workspacePath, "body.mjs"), `
      import fs from "node:fs";
      fs.writeFileSync(${JSON.stringify(marker)}, "ran");
      setInterval(() => {}, 1000);
    `);
    fixture.store.setPid = (() => {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
      throw new Error("simulated durable persistence failure");
    }) as TaskStore["setPid"];
    const runner = new TaskRunner({
      workspaceStore: fixture.workspaces,
      taskStore: fixture.store,
      taskDir: path.join(fixture.root, "tasks"),
      authorizeExecution: () => true,
    });

    try {
      await expect(runner.start({
        workspaceId: fixture.workspace.id,
        kind: "test",
        executable: "node",
        args: ["body.mjs"],
        timeoutMs: 2_000,
        requestedBy: "owner",
      })).rejects.toThrow("simulated durable persistence failure");
    } finally {
      await runner.shutdown();
    }

    expect(fs.existsSync(marker)).toBe(false);
  });

  it("exits without launching task code when the Server crashes after ready but before authorization", async () => {
    const fixture = await taskFixture();
    const taskDir = path.join(fixture.root, "crash-handshake");
    fs.mkdirSync(taskDir);
    const readyPath = path.join(taskDir, "supervisor.ready");
    const startPath = path.join(taskDir, "supervisor.start");
    const supervisorPidPath = path.join(taskDir, "supervisor.pid");
    const marker = path.join(taskDir, "task-body-ran");
    const body = path.join(taskDir, "body.mjs");
    const harness = path.join(taskDir, "crashing-server.mjs");
    const supervisorPath = path.resolve(__dirname, "../runner/task-supervisor.mjs");
    fs.writeFileSync(body, `
      import fs from "node:fs";
      fs.writeFileSync(${JSON.stringify(marker)}, "ran");
    `);
    fs.writeFileSync(harness, `
      import { spawn } from "node:child_process";
      import fs from "node:fs";
      const child = spawn(process.execPath, ${JSON.stringify([
        supervisorPath,
        "crash-before-authorization-token",
        readyPath,
        startPath,
        process.execPath,
        Buffer.from(JSON.stringify([body]), "utf8").toString("base64url"),
      ])}, { detached: true, stdio: "ignore" });
      fs.writeFileSync(${JSON.stringify(supervisorPidPath)}, String(child.pid));
      const deadline = Date.now() + 3000;
      const timer = setInterval(() => {
        if (fs.existsSync(${JSON.stringify(readyPath)})) process.exit(0);
        if (Date.now() >= deadline) process.exit(124);
      }, 10);
      timer.unref();
    `);
    const server = spawn(process.execPath, [harness], { stdio: "ignore" });
    const [serverCode] = await once(server, "close") as [number | null, NodeJS.Signals | null];
    expect(serverCode).toBe(0);
    const supervisorPid = Number(fs.readFileSync(supervisorPidPath, "utf8"));

    try {
      await expectProcessGone(supervisorPid);
      expect(fs.existsSync(marker)).toBe(false);
      expect(fs.existsSync(startPath)).toBe(false);
    } finally {
      if (isProcessAlive(supervisorPid)) {
        try { process.kill(-supervisorPid, "SIGKILL"); } catch { /* already gone */ }
      }
    }
  });

  it("reconciliation makes the supervisor force-kill a TERM-resistant real child", async () => {
    if (process.platform === "win32") return;
    const fixture = await taskFixture();
    const taskDir = path.join(fixture.root, "tasks");
    fs.mkdirSync(taskDir, { recursive: true });
    const token = "term-resistant-reconciliation-token";
    const readyPath = path.join(taskDir, "supervisor.ready");
    const startPath = path.join(taskDir, "supervisor.start");
    const childPidPath = path.join(taskDir, "term-resistant.pid");
    const body = path.join(fixture.workspaces.pathFor(fixture.workspace.id), "term-resistant.mjs");
    fs.writeFileSync(body, `
      import fs from "node:fs";
      process.on("SIGTERM", () => {});
      fs.writeFileSync(${JSON.stringify(childPidPath)}, String(process.pid));
      setInterval(() => {}, 1000);
    `);
    const supervisorPath = path.resolve(__dirname, "../runner/task-supervisor.mjs");
    const supervisor = spawn(process.execPath, [
      supervisorPath,
      token,
      readyPath,
      startPath,
      process.execPath,
      Buffer.from(JSON.stringify([body]), "utf8").toString("base64url"),
    ], {
      cwd: fixture.workspaces.pathFor(fixture.workspace.id),
      detached: true,
      stdio: "ignore",
    });
    const supervisorClosed = once(supervisor, "close");

    try {
      await waitForFile(readyPath);
      expect(JSON.parse(fs.readFileSync(readyPath, "utf8"))).toEqual({ pid: supervisor.pid, token });
      const controller = new ProcessTreeController();
      const identity = await controller.processIdentity(supervisor.pid!);
      const task = fixture.store.create({
        workspaceId: fixture.workspace.id,
        kind: "test",
        executable: "node",
        args: [body],
        timeoutMs: 10_000,
        requestedBy: "owner",
        outputPath: path.join(taskDir, "term-resistant.log"),
        status: "running",
        pid: supervisor.pid,
        processIdentity: identity,
      });
      fs.writeFileSync(startPath, token, { flag: "wx", mode: 0o600 });
      await waitForFile(childPidPath);
      const childPid = Number(fs.readFileSync(childPidPath, "utf8"));
      const runner = new TaskRunner({
        workspaceStore: fixture.workspaces,
        taskStore: fixture.store,
        taskDir,
        authorizeExecution: () => true,
        processController: controller,
      });

      await runner.reconcileRunning();

      expect(fixture.store.get(task.id)?.status).toBe("interrupted");
      await supervisorClosed;
      await expectProcessGone(childPid);
    } finally {
      if (supervisor.pid && isProcessAlive(supervisor.pid)) {
        try { process.kill(-supervisor.pid, "SIGKILL"); } catch { /* already gone */ }
      }
    }
  });
});

describe("executable discovery", () => {
  it("ignores a non-executable POSIX PATH file", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "localapp-executable-"));
    roots.push(root);
    const candidate = path.join(root, "fixture-agent");
    fs.writeFileSync(candidate, "#!/bin/sh\nexit 0\n", { mode: 0o600 });

    expect(findExecutable("fixture-agent", { platform: "darwin", pathValue: root })).toBeNull();
    fs.chmodSync(candidate, 0o700);
    expect(findExecutable("fixture-agent", { platform: "darwin", pathValue: root })).toBe(fs.realpathSync(candidate));
  });

  it("rejects a non-executable explicitly allowlisted POSIX file", async () => {
    if (process.platform === "win32") return;
    const fixture = await taskFixture();
    const candidate = path.join(fixture.root, "not-executable");
    fs.writeFileSync(candidate, "not executable", { mode: 0o600 });
    const runner = new TaskRunner({
      workspaceStore: fixture.workspaces,
      taskStore: fixture.store,
      taskDir: path.join(fixture.root, "tasks"),
      authorizeExecution: () => true,
    });

    expect(() => runner.setAllowedExecutable("fixture", candidate)).toThrow("not executable");
  });

  it("does not report or launch Windows cmd/bat shims through shell:false", async () => {
    const fixture = await taskFixture();
    const cmdShim = path.join(fixture.root, "codex.CMD");
    const batShim = path.join(fixture.root, "opencode.BAT");
    fs.writeFileSync(cmdShim, `#!${process.execPath}\nprocess.exit(0);\n`, { mode: 0o700 });
    fs.writeFileSync(batShim, `#!${process.execPath}\nprocess.exit(0);\n`, { mode: 0o700 });
    const discover = (name: "codex" | "opencode") => findExecutable(name, {
      platform: "win32",
      pathValue: fixture.root,
      pathExt: ".CMD;.BAT;.EXE;.COM",
    });
    const runner = new TaskRunner({
      workspaceStore: fixture.workspaces,
      taskStore: fixture.store,
      taskDir: path.join(fixture.root, "tasks"),
      authorizeExecution: () => true,
      platform: "win32",
    });
    const agents = new AgentRunner({ taskRunner: runner, executableResolver: discover });
    let allowlistRejections = 0;
    for (const [name, shim] of [["cmd-shim", cmdShim], ["bat-shim", batShim]] as const) {
      try {
        runner.setAllowedExecutable(name, shim);
      } catch {
        allowlistRejections += 1;
      }
    }
    let launchRejected = false;
    try {
      await runner.start({
        workspaceId: fixture.workspace.id,
        kind: "agent",
        executable: "shim",
        args: [],
        timeoutMs: 1_000,
        requestedBy: "owner",
      });
    } catch {
      launchRejected = true;
    } finally {
      await runner.shutdown();
    }

    expect({
      discovered: [discover("codex"), discover("opencode")],
      available: agents.capabilities().map((capability) => capability.available),
      allowlistRejections,
      launchRejected,
    }).toEqual({
      discovered: [null, null],
      available: [false, false],
      allowlistRejections: 2,
      launchRejected: true,
    });
  });
});

async function taskFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "localapp-process-tree-"));
  roots.push(root);
  await initMetaDb(root);
  const workspaces = new WorkspaceStore({ workspaceDir: path.join(root, "workspaces") });
  const workspace = await workspaces.create({ name: "Process", ownerId: "owner" });
  return { root, workspaces, workspace, store: new TaskStore() };
}

async function expectProcessGone(pid: number): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`process ${pid} is still alive`);
}

async function waitForFile(filePath: string): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    if (fs.existsSync(filePath)) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`file was not created: ${filePath}`);
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

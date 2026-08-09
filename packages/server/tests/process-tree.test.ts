import { afterEach, describe, expect, it } from "vitest";
import { once } from "node:events";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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

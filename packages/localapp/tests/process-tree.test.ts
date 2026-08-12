import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  spawnOwnedProcess,
  type OwnedProcess,
  type OwnedProcessExit,
  type UnixOwnedProcessHandle,
  type UnixProcessTreeAdapter,
} from "../src/process/process-tree.js";

const repositoryRoot = path.resolve(process.cwd(), "../..");
const testRoot = path.join(repositoryRoot, "tmp/task-6-process-tree-tests");
const directories: string[] = [];
const ownedProcesses: OwnedProcess[] = [];

beforeAll(async () => {
  await fs.mkdir(testRoot, { recursive: true });
});

afterEach(async () => {
  await Promise.allSettled(ownedProcesses.splice(0).map((owned) => owned.terminate()));
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("owned process trees", () => {
  it("reports deterministic forced exit and waits for group disappearance when guardian exits first", async () => {
    // Break caught: guardian exit can beat its command-exit IPC and make terminate resolve with a synthetic protocol error while the group remains.
    if (process.platform === "win32") return;
    vi.useFakeTimers();
    try {
      const model = new ForcedCleanupModel();
      const owned = spawnOwnedProcess(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
        stdio: "ignore",
        gracefulTimeoutMs: 20,
        forceTimeoutMs: 100,
        unixAdapter: model,
      });
      ownedProcesses.push(owned);
      let terminated = false;
      const termination = owned.terminate().then(() => { terminated = true; });

      await vi.advanceTimersByTimeAsync(20);

      await expect(owned.exited).resolves.toEqual({ code: null, signal: "SIGKILL" });
      expect(terminated).toBe(false);
      expect(model.groupChecks).toBeGreaterThan(0);

      model.groupPresent = false;
      await vi.advanceTimersByTimeAsync(20);
      await termination;

      expect(model.signals).toEqual(["SIGTERM", "SIGKILL"]);
      expect(terminated).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails closed on post-force replacement liveness without sending another signal", async () => {
    // Break caught: treating a reused PGID as owned after force can either resolve before disappearance or send a second KILL to the replacement.
    if (process.platform === "win32") return;
    vi.useFakeTimers();
    try {
      const model = new ForcedCleanupModel();
      const owned = spawnOwnedProcess(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
        stdio: "ignore",
        gracefulTimeoutMs: 20,
        forceTimeoutMs: 40,
        unixAdapter: model,
      });
      ownedProcesses.push(owned);
      const termination = owned.terminate().then(
        () => undefined,
        (error: unknown) => error,
      );

      await vi.advanceTimersByTimeAsync(60);

      await expect(termination).resolves.toEqual(expect.objectContaining({
        code: "owned_process_tree_exit_unconfirmed",
        message: expect.stringMatching(/could not confirm.*group.*disappeared/i),
      }));
      expect(model.signals).toEqual(["SIGTERM", "SIGKILL"]);
      expect(model.groupChecks).toBeGreaterThan(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves the actual result when the command exits normally before cleanup", async () => {
    // Break caught: always preferring the force sentinel discards an actual command status already reported by the guardian.
    if (process.platform === "win32") return;
    const owned = spawnOwnedProcess(process.execPath, ["-e", "process.exit(7)"], {
      stdio: "ignore",
      gracefulTimeoutMs: 20,
      forceTimeoutMs: 2_000,
    });
    ownedProcesses.push(owned);

    await expect(owned.exited).resolves.toEqual({ code: 7, signal: null });
    await owned.terminate();
    await expect(owned.exited).resolves.toEqual({ code: 7, signal: null });
  });

  it("fails closed without signaling a replacement group when guardian identity retires before escalation", async () => {
    // Break caught: a cached numeric PGID can be reused after graceful polling and then receive the owned tree's SIGKILL.
    if (process.platform === "win32") return;
    vi.useFakeTimers();
    try {
      const model = new ReusedUnixGroupModel();
      const owned = spawnOwnedProcess(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
        stdio: "ignore",
        gracefulTimeoutMs: 20,
        forceTimeoutMs: 20,
        unixAdapter: model,
      });
      ownedProcesses.push(owned);
      const termination = owned.terminate().then(
        () => undefined,
        (error: unknown) => error,
      );
      await vi.advanceTimersByTimeAsync(19);

      expect(model.signalAttempts).toEqual([{ identity: "owned", signal: "SIGTERM" }]);

      await vi.advanceTimersByTimeAsync(1);
      await expect(termination).resolves.toEqual(expect.objectContaining({
        message: expect.stringMatching(/ownership identity.*lost/i),
      }));

      expect(model.signalAttempts).toEqual([
        { identity: "owned", signal: "SIGTERM" },
        { identity: "replacement", signal: "SIGKILL" },
      ]);
      expect(model.ownedSignals).toEqual(["SIGTERM"]);
      expect(model.replacementSignals).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("terminates a stubborn descendant after its process-group leader already exited", async () => {
    // Break caught: signaling only the child PID leaves a TERM-resistant grandchild orphaned after the leader exits.
    if (process.platform === "win32") return;
    const directory = await fixtureDirectory();
    const grandchildPidPath = path.join(directory, "grandchild.pid");
    const leader = `
      const { spawn } = require("node:child_process");
      const fs = require("node:fs");
      const child = spawn(process.execPath, ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], {
        stdio: "ignore",
      });
      fs.writeFileSync(${JSON.stringify(grandchildPidPath)}, String(child.pid));
      process.exit(0);
    `;
    const owned = spawnOwnedProcess(process.execPath, ["-e", leader], {
      cwd: directory,
      stdio: "ignore",
      gracefulTimeoutMs: 100,
      forceTimeoutMs: 2_000,
    });
    ownedProcesses.push(owned);
    await owned.exited;
    const grandchildPid = Number(await waitForFile(grandchildPidPath));
    expect(await processExists(grandchildPid)).toBe(true);

    await owned.terminate();

    expect(await waitForCondition(() => processExists(grandchildPid).then((alive) => !alive), "grandchild exit")).toBe(true);
  });

  it("terminates its detached tree without touching an unrelated process", async () => {
    // Break caught: broad descendant discovery or a PID-0/current-group signal can terminate unrelated user processes.
    if (process.platform === "win32") return;
    const directory = await fixtureDirectory();
    const unrelated = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
    const owned = spawnOwnedProcess(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      cwd: directory,
      stdio: "ignore",
      gracefulTimeoutMs: 100,
      forceTimeoutMs: 2_000,
    });
    ownedProcesses.push(owned);
    try {
      expect(owned.pid).toBeGreaterThan(1);
      expect(owned.pid).not.toBe(process.pid);

      await owned.terminate();

      expect(await processExists(unrelated.pid!)).toBe(true);
    } finally {
      unrelated.kill("SIGKILL");
      await new Promise<void>((resolve) => unrelated.once("exit", () => resolve()));
    }
  });

  it("fails closed on Windows when the suspended-root Job Object adapter is unavailable", () => {
    // Break caught: ordinary Windows spawn races descendants before Task 8 can assign the root to a Job Object.
    expect(() => spawnOwnedProcess(process.execPath, ["-e", "process.exit(0)"], {
      platform: "win32",
      stdio: "ignore",
    })).toThrow(/Windows process-tree adapter.*unavailable/i);
  });
});

class ForcedCleanupModel implements UnixProcessTreeAdapter {
  readonly signals: NodeJS.Signals[] = [];
  groupPresent = true;
  groupChecks = 0;
  private readonly commandExit = deferred<OwnedProcessExit>();
  private readonly guardianExit = deferred<OwnedProcessExit>();

  spawnOwned(_command: string, _args: readonly string[], _options: SpawnOptions): UnixOwnedProcessHandle {
    const child = fakeChild(51_051);
    return {
      child,
      commandExited: this.commandExit.promise,
      guardianExited: this.guardianExit.promise,
      signalOwnedTree: async (force, onDispatched?: () => void) => {
        const signal = force ? "SIGKILL" : "SIGTERM";
        this.signals.push(signal);
        if (force) {
          onDispatched?.();
          this.guardianExit.resolve({ code: null, signal: "SIGKILL" });
          this.commandExit.resolve({
            code: null,
            signal: null,
            error: new Error("guardian exited before command IPC"),
          });
        }
        return "signaled";
      },
      ownedGroupExists: async () => {
        this.groupChecks += 1;
        return this.groupPresent;
      },
    };
  }
}

class ReusedUnixGroupModel implements UnixProcessTreeAdapter {
  readonly signalAttempts: Array<{ identity: "owned" | "replacement"; signal: NodeJS.Signals }> = [];
  readonly ownedSignals: NodeJS.Signals[] = [];
  readonly replacementSignals: NodeJS.Signals[] = [];
  private identity: "owned" | "replacement" = "owned";
  private readonly commandExit = deferred<OwnedProcessExit>();
  private readonly guardianExit = deferred<OwnedProcessExit>();

  spawnOwned(_command: string, _args: readonly string[], _options: SpawnOptions): UnixOwnedProcessHandle {
    const child = fakeChild(42_424);
    return {
      child,
      commandExited: this.commandExit.promise,
      guardianExited: this.guardianExit.promise,
      signalOwnedTree: async (force) => {
        const signal = force ? "SIGKILL" : "SIGTERM";
        this.signalAttempts.push({ identity: this.identity, signal });
        if (this.identity === "replacement") {
          return "ownership-lost";
        }
        this.ownedSignals.push(signal);
        if (!force) {
          this.identity = "replacement";
          this.commandExit.resolve({ code: 0, signal: null });
          this.guardianExit.resolve({ code: 0, signal: null });
        }
        return "signaled";
      },
      ownedGroupExists: () => true,
    };
  }
}

function fakeChild(pid: number): ChildProcess {
  return Object.assign(new EventEmitter(), {
    pid,
    exitCode: null,
    signalCode: null,
    stdout: null,
    stderr: null,
    stdin: null,
  }) as ChildProcess;
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function fixtureDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(testRoot, "case-"));
  directories.push(directory);
  return directory;
}

async function waitForFile(filePath: string): Promise<string> {
  return waitForCondition(async () => fs.readFile(filePath, "utf8").catch(() => undefined), `file ${filePath}`);
}

async function waitForCondition<T>(condition: () => T | undefined | false | Promise<T | undefined | false>, label: string, timeoutMs = 3_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await condition();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function processExists(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0);
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
  if (process.platform === "win32") return true;
  return new Promise((resolve) => {
    const child = spawn("ps", ["-o", "stat=", "-p", String(pid)], { stdio: ["ignore", "pipe", "ignore"] });
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.once("exit", (code) => resolve(code === 0 && !output.trimStart().startsWith("Z")));
    child.once("error", () => resolve(true));
  });
}

import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  confirmGuardianSignalDispatch,
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
  it("requires guardian send callback success before accepting a signal response", async () => {
    // Break caught: a fast guardian response can settle force before the delayed parent send callback reports an async write failure.
    const sendCallback = deferred<void>();
    const response = deferred<"signaled" | "ownership-lost">();
    let result: "signaled" | "ownership-lost" | undefined;
    const confirmation = confirmGuardianSignalDispatch(sendCallback.promise, response.promise);
    void confirmation.then((value) => { result = value; });

    response.resolve("signaled");
    await Promise.resolve();
    expect(result).toBeUndefined();

    sendCallback.reject(new Error("guardian send callback failed"));
    await expect(confirmation).resolves.toBe("ownership-lost");
  });

  it("does not report synthetic SIGKILL when the delayed force-send callback fails", async () => {
    // Break caught: invoking onDispatched before guardian.send's callback can falsely report SIGKILL for an IPC send that later fails.
    if (process.platform === "win32") return;
    vi.useFakeTimers();
    try {
      const model = new ForceSendCallbackFailureModel();
      const owned = spawnOwnedProcess(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
        stdio: "ignore",
        gracefulTimeoutMs: 20,
        forceTimeoutMs: 40,
        unixAdapter: model,
      });
      const termination = settled(owned.terminate());

      await vi.advanceTimersByTimeAsync(30);

      await expect(termination).resolves.toEqual(expect.objectContaining({
        message: expect.stringMatching(/ownership identity.*lost/i),
      }));
      await expect(owned.exited).resolves.toEqual(expect.objectContaining({
        code: null,
        signal: null,
        error: expect.objectContaining({ message: "guardian send callback failed" }),
      }));
      expect(model.signals).toEqual(["SIGTERM", "SIGKILL"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("bounds a never-resolving liveness read and still attempts guardian reap", async () => {
    // Break caught: directly awaiting ownedGroupExists lets one hung read make terminate unbounded and skip guardian reaping.
    if (process.platform === "win32") return;
    vi.useFakeTimers();
    try {
      const model = new HungLivenessModel();
      const owned = spawnOwnedProcess(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
        stdio: "ignore",
        gracefulTimeoutMs: 20,
        forceTimeoutMs: 40,
        unixAdapter: model,
      });
      let result: unknown;
      void settled(owned.terminate()).then((value) => { result = value; });

      await vi.advanceTimersByTimeAsync(100);

      expect(result).toEqual(expect.objectContaining({ code: "owned_process_tree_exit_unconfirmed" }));
      expect(model.guardianReaped).toBe(true);
      expect(model.signals).toEqual(["SIGTERM", "SIGKILL"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("waits for bounded guardian reap and preserves the primary group-confirmation error", async () => {
    // Break caught: group-confirmation failure can reject immediately, skipping delayed guardian reap or replacing its structured error.
    if (process.platform === "win32") return;
    vi.useFakeTimers();
    try {
      const model = new PresentGroupDelayedReapFailureModel();
      const owned = spawnOwnedProcess(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
        stdio: "ignore",
        gracefulTimeoutMs: 20,
        forceTimeoutMs: 40,
        unixAdapter: model,
      });
      let result: unknown;
      void settled(owned.terminate()).then((value) => { result = value; });

      await vi.advanceTimersByTimeAsync(79);
      expect(result).toBeUndefined();

      await vi.advanceTimersByTimeAsync(1);
      expect(result).toEqual(expect.objectContaining({
        code: "owned_process_tree_exit_unconfirmed",
        message: expect.stringMatching(/could not confirm.*group.*disappeared/i),
      }));
      expect(model.reapFailed).toBe(true);
      expect(model.signals).toEqual(["SIGTERM", "SIGKILL"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("consumes a rejected command-exit observer when the caller awaits only terminate", async () => {
    // Break caught: a true commandExited rejection can surface as unhandled when cleanup callers never read OwnedProcess.exited.
    if (process.platform === "win32") return;
    const model = new RejectedCommandExitModel();
    const unhandled: unknown[] = [];
    const onUnhandled = (error: unknown) => { unhandled.push(error); };
    process.on("unhandledRejection", onUnhandled);
    try {
      const owned = spawnOwnedProcess(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
        stdio: "ignore",
        gracefulTimeoutMs: 0,
        forceTimeoutMs: 40,
        unixAdapter: model,
      });

      await owned.terminate();
      await Promise.resolve();

      expect(unhandled).toEqual([]);
      expect(model.signals).toEqual(["SIGTERM", "SIGKILL"]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

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

class ForceSendCallbackFailureModel implements UnixProcessTreeAdapter {
  readonly signals: NodeJS.Signals[] = [];
  private readonly commandExit = deferred<OwnedProcessExit>();
  private readonly guardianExit = deferred<OwnedProcessExit>();

  spawnOwned(_command: string, _args: readonly string[], _options: SpawnOptions): UnixOwnedProcessHandle {
    return {
      child: fakeChild(61_061),
      commandExited: this.commandExit.promise,
      guardianExited: this.guardianExit.promise,
      signalOwnedTree: (force, onDispatched) => {
        this.signals.push(force ? "SIGKILL" : "SIGTERM");
        if (!force) return "signaled";
        onDispatched?.();
        return new Promise((resolve) => {
          setTimeout(() => {
            this.commandExit.resolve({ code: null, signal: null, error: new Error("guardian send callback failed") });
            this.guardianExit.resolve({ code: 1, signal: null });
            resolve("ownership-lost");
          }, 10);
        });
      },
      ownedGroupExists: () => false,
    };
  }
}

class HungLivenessModel implements UnixProcessTreeAdapter {
  readonly signals: NodeJS.Signals[] = [];
  guardianReaped = false;
  private readonly commandExit = deferred<OwnedProcessExit>();
  private readonly guardianExit = deferred<OwnedProcessExit>();

  spawnOwned(_command: string, _args: readonly string[], _options: SpawnOptions): UnixOwnedProcessHandle {
    return {
      child: fakeChild(62_062),
      commandExited: this.commandExit.promise,
      guardianExited: this.guardianExit.promise.then((exit) => {
        this.guardianReaped = true;
        return exit;
      }),
      signalOwnedTree: (force, onDispatched) => {
        this.signals.push(force ? "SIGKILL" : "SIGTERM");
        if (force) {
          onDispatched?.();
          this.guardianExit.resolve({ code: null, signal: "SIGKILL" });
        }
        return "signaled";
      },
      ownedGroupExists: () => new Promise<boolean>(() => {}),
    };
  }
}

class PresentGroupDelayedReapFailureModel implements UnixProcessTreeAdapter {
  readonly signals: NodeJS.Signals[] = [];
  reapFailed = false;
  private readonly commandExit = deferred<OwnedProcessExit>();
  private readonly guardianExit = deferred<OwnedProcessExit>();

  spawnOwned(_command: string, _args: readonly string[], _options: SpawnOptions): UnixOwnedProcessHandle {
    return {
      child: fakeChild(63_063),
      commandExited: this.commandExit.promise,
      guardianExited: this.guardianExit.promise.catch((error) => {
        this.reapFailed = true;
        throw error;
      }),
      signalOwnedTree: (force, onDispatched) => {
        this.signals.push(force ? "SIGKILL" : "SIGTERM");
        if (force) {
          onDispatched?.();
          setTimeout(() => this.guardianExit.reject(new Error("guardian reap failed")), 60);
        }
        return "signaled";
      },
      ownedGroupExists: () => true,
    };
  }
}

class RejectedCommandExitModel implements UnixProcessTreeAdapter {
  readonly signals: NodeJS.Signals[] = [];
  private readonly commandExit = deferred<OwnedProcessExit>();
  private readonly guardianExit = deferred<OwnedProcessExit>();

  spawnOwned(_command: string, _args: readonly string[], _options: SpawnOptions): UnixOwnedProcessHandle {
    return {
      child: fakeChild(64_064),
      commandExited: this.commandExit.promise,
      guardianExited: this.guardianExit.promise,
      signalOwnedTree: (force, onDispatched) => {
        this.signals.push(force ? "SIGKILL" : "SIGTERM");
        if (force) {
          onDispatched?.();
          this.commandExit.reject(new Error("command exit observer rejected"));
          this.guardianExit.resolve({ code: null, signal: "SIGKILL" });
        }
        return "signaled";
      },
      ownedGroupExists: () => false,
    };
  }
}

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
          setTimeout(() => {
            this.guardianExit.resolve({ code: null, signal: "SIGKILL" });
            this.commandExit.resolve({
              code: null,
              signal: null,
              error: new Error("guardian exited before command IPC"),
            });
          }, 0);
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

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void } {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function settled(promise: Promise<void>): Promise<void | unknown> {
  return promise.then(() => undefined, (error: unknown) => error);
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

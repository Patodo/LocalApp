import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { spawnOwnedProcess, type OwnedProcess } from "../src/process/process-tree.js";

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

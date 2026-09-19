import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { runServerForeground } from "../src/commands/server.js";
import { buildLocalAppPackage } from "../scripts/build-package.mjs";
import type { OwnedProcess } from "../src/process/process-tree.js";
const root = path.resolve(process.cwd(), "../..");
const testRoot = path.join(root, "tmp/task-7b-foreground-tests");
const packageArtifact = path.join(testRoot, "package-artifact");
const directories: string[] = [];

beforeAll(async () => {
  await fs.mkdir(testRoot, { recursive: true });
  await buildLocalAppPackage({ outputDirectory: packageArtifact });
}, 120_000);
afterAll(async () => { await fs.rm(packageArtifact, { recursive: true, force: true }); });
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true }))); });

describe("server run foreground ownership", () => {
  it("does not resolve supervisor exit until owned-tree termination completes", async () => {
    const fixture = await fs.mkdtemp(path.join(testRoot, "fixture-"));
    directories.push(fixture);
    let exit!: (value: { code: number }) => void;
    let releaseTerminate!: () => void;
    const terminate = vi.fn(() => new Promise<void>((resolve) => { releaseTerminate = resolve; }));
    const owned = { child: new EventEmitter(), pid: 42, exited: new Promise<{ code: number }>((resolve) => { exit = resolve; }), terminate } as unknown as OwnedProcess;
    let settled = false;
    let spawned = false;
    const result = runServerForeground({}, { artifactDirectory: packageArtifact, spawnOwnedProcess: () => { spawned = true; return owned; } }).then((value) => { settled = true; return value; });
    while (!spawned) await new Promise((resolve) => setImmediate(resolve));
    exit({ code: 0 });
    await new Promise((resolve) => setImmediate(resolve));
    expect(terminate).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);
    releaseTerminate();
    await expect(result).resolves.toBe(0);
  });

  it("keeps one stable default port unless the operator asks for another", async () => {
    // Break caught: the foreground Server picked an ephemeral port on every
    // start, so a saved profile, a proxy target, or a published container port
    // had to follow a port the Server chose for itself.
    const invocations: string[][] = [];
    const ownedStub = () => {
      const child = new EventEmitter() as unknown as OwnedProcess["child"];
      return {
        child,
        pid: 42,
        exited: Promise.resolve({ code: 0, signal: null }),
        terminate: async () => undefined,
      } as unknown as OwnedProcess;
    };
    const run = (options: { port?: number }) => runServerForeground(options, {
      artifactDirectory: packageArtifact,
      spawnOwnedProcess: (_command, args) => { invocations.push([...args]); return ownedStub(); },
    });

    await expect(run({})).resolves.toBe(0);
    await expect(run({ port: 55441 })).resolves.toBe(0);
    await expect(run({ port: 0 })).resolves.toBe(0);

    const portOf = (args: string[]) => args[args.indexOf("--port") + 1];
    expect(invocations.map(portOf)).toEqual(["50524", "55441", "0"]);
  });
});

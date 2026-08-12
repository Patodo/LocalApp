import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { CliIo } from "../src/cli/output.js";
import { DevLifecycle, runDev, writeDevConfig, type RunDevDependencies } from "../src/commands/dev.js";
import { readOrCreateDevCredentials } from "../src/dev/credentials.js";
import { spawnOwnedProcess, type OwnedProcess } from "../src/process/process-tree.js";
import { waitForServerReady } from "../src/process/readiness.js";
import { runLocalApp } from "../src/main.js";

const repositoryRoot = path.resolve(process.cwd(), "../..");
const testRoot = path.join(repositoryRoot, "tmp/task-6-dev-tests");
const directories: string[] = [];
const processes: OwnedProcess[] = [];
const blockedFetches: Array<(error: Error) => void> = [];
const buildFixtures: Array<{ cleanupPath: string; pidsPath: string }> = [];
type BuildSignalCarrier = { signal?: AbortSignal };

beforeAll(async () => {
  await fs.mkdir(testRoot, { recursive: true });
});

afterEach(async () => {
  for (const reject of blockedFetches.splice(0)) reject(new Error("dev test released blocked fetch"));
  await Promise.all(buildFixtures.map((fixture) => fs.writeFile(fixture.cleanupPath, "stop\n").catch(() => undefined)));
  await Promise.allSettled(processes.splice(0).map((process) => process.terminate()));
  await Promise.allSettled(buildFixtures.splice(0).flatMap((fixture) => [
    fs.readFile(fixture.pidsPath, "utf8")
      .then((value) => JSON.parse(value) as number[])
      .then((pids) => Promise.all(pids.map((pid) => waitForProcessExit(pid)))),
  ]));
  vi.unstubAllGlobals();
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("canonical local development", () => {
  it("reports asynchronous dev startup failures as structured CLI errors", async () => {
    // Break caught: returning the runDev promise outside the CLI try/catch leaks an unhandled stack trace.
    const output = captureIo();

    await expect(runLocalApp(["dev"], output.io)).resolves.toBe(1);

    expect(output.stderr).toContain('"code":"project_manifest_missing"');
    expect(output.stderr).not.toContain("LocalAppLifecycleError");
  });

  it("keeps stable CSPRNG credentials private and dev-config credential-free", async () => {
    // Break caught: predictable or public dev credentials allow another local user or checked-in config to impersonate the owner.
    const projectDir = await fixtureProject();
    const durableConfig = path.join(projectDir, ".localapp/project-config.json");
    await fs.writeFile(durableConfig, '{"autoSync":false,"sentinel":"preserve"}\n');

    const first = await readOrCreateDevCredentials(projectDir);
    const second = await readOrCreateDevCredentials(projectDir);
    await writeDevConfig({
      projectDir,
      serverUrl: "http://127.0.0.1:43127",
      pageName: "task-six-app",
      appServerPort: 5182,
    });

    expect(second).toEqual(first);
    expect(first.apiKey).toMatch(/^localapp_dev_[0-9a-f]{64}$/);
    expect(first.password).toMatch(/^localapp_dev_password_[0-9a-f]{64}$/);
    expect(first.jwtSecret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const stateRoot = path.join(projectDir, "tmp/localapp-dev");
    expect(Object.values(first.paths).every((filePath) => path.dirname(filePath) === stateRoot)).toBe(true);
    if (process.platform !== "win32") {
      for (const filePath of Object.values(first.paths)) {
        expect((await fs.stat(filePath)).mode & 0o777).toBe(0o600);
      }
    }
    expect(JSON.parse(await fs.readFile(path.join(projectDir, ".localapp/dev-config.json"), "utf8"))).toEqual({
      serverUrl: "http://127.0.0.1:43127",
      userId: "dev-user",
      pageName: "task-six-app",
      appServerPort: 5182,
    });
    expect(await fs.readFile(durableConfig, "utf8")).toBe('{"autoSync":false,"sentinel":"preserve"}\n');
  });

  it("accepts only the structured exact loopback Server ready listener", async () => {
    // Break caught: trusting public url, arbitrary log text, or a non-loopback listenUrl can expose dev credentials over the network.
    const projectDir = await fixtureProject();
    const valid = spawnOwnedProcess(process.execPath, ["-e", `
      console.log("Server listening at https://public.example");
      console.log(JSON.stringify({ type: "ready", url: "https://public.example", listenUrl: "http://127.0.0.1:43127" }));
      setInterval(() => {}, 1000);
    `], { cwd: projectDir, stdio: ["ignore", "pipe", "ignore"] });
    processes.push(valid);

    await expect(waitForServerReady(valid, { timeoutMs: 1_000 })).resolves.toMatchObject({
      listenUrl: "http://127.0.0.1:43127",
    });

    const invalid = spawnOwnedProcess(process.execPath, ["-e", `
      console.log(JSON.stringify({ type: "ready", url: "https://public.example", listenUrl: "http://0.0.0.0:43127" }));
      setInterval(() => {}, 1000);
    `], { cwd: projectDir, stdio: ["ignore", "pipe", "ignore"] });
    processes.push(invalid);
    await expect(waitForServerReady(invalid, { timeoutMs: 1_000 })).rejects.toThrow(/exact http:\/\/127\.0\.0\.1:<port>/i);
  });

  it("bounds Server readiness and terminates the silent process tree", async () => {
    // Break caught: an unstructured or wedged Server can hang localapp dev indefinitely and survive startup failure.
    const projectDir = await fixtureProject();
    const silent = spawnOwnedProcess(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      cwd: projectDir,
      stdio: ["ignore", "pipe", "ignore"],
      gracefulTimeoutMs: 50,
      forceTimeoutMs: 1_000,
    });
    processes.push(silent);
    const started = Date.now();

    await expect(waitForServerReady(silent, { timeoutMs: 100 })).rejects.toThrow(/readiness timed out after 100 ms/i);
    await silent.terminate();

    expect(Date.now() - started).toBeLessThan(2_000);
    await expect(silent.exited).resolves.toBeDefined();
  });

  it("an abort during Server readiness terminates startup immediately", async () => {
    // Break caught: consulting AbortSignal only after Vite starts leaves a silent Server alive until the 15-second readiness deadline.
    const projectDir = await fixtureProject();
    const fixtureRoot = path.join(projectDir, "tmp/localapp-dev/fixtures");
    await fs.mkdir(fixtureRoot, { recursive: true });
    const serverLauncher = path.join(fixtureRoot, "silent-server.mjs");
    const pidPath = path.join(fixtureRoot, "silent-server.pid");
    await fs.writeFile(serverLauncher, `
      import fs from "node:fs";
      fs.writeFileSync(${JSON.stringify(pidPath)}, String(process.pid));
      setInterval(() => {}, 1000);
    `);
    const controller = new AbortController();
    const output = captureIo();
    const running = runDev({ projectDir, signal: controller.signal, io: output.io }, {
      serverLauncher,
      readyTimeoutMs: 5_000,
      buildApplicationPackage: fakePackageBuilder(fixtureRoot),
    });
    const pid = Number(await waitForFile(pidPath));
    const started = Date.now();

    controller.abort();

    await expect(running).resolves.toBe(0);
    expect(Date.now() - started).toBeLessThan(1_000);
    await expect(waitForProcessExit(pid)).resolves.toBe(true);
    expect(output.stderr).not.toContain("Local Server exited unexpectedly");
  });

  it("aborts a never-resolving package build and starts Server cleanup exactly once", async () => {
    // Break caught: awaiting an injected or wedged package build prevents abort from reaching the owned Server cleanup path.
    const projectDir = await fixtureProject();
    const fixtureRoot = path.join(projectDir, "tmp/localapp-dev/fixtures");
    await fs.mkdir(fixtureRoot, { recursive: true });
    const serverLauncher = await writeFakeServer(fixtureRoot);
    const controller = new AbortController();
    const buildStarted = deferred<void>();
    const buildRelease = deferred<ReturnType<typeof fakePackageResult>>();
    let buildSignal: AbortSignal | undefined;
    let serverTerminateCalls = 0;
    const running = runDev({ projectDir, signal: controller.signal, io: captureIo().io }, {
      serverLauncher,
      buildApplicationPackage: async (options) => {
        buildSignal = (options as BuildSignalCarrier).signal;
        buildStarted.resolve();
        return buildRelease.promise;
      },
      spawnOwnedProcess: (...args) => {
        const owned = spawnOwnedProcess(...args);
        const tracked = {
          ...owned,
          terminate() {
            serverTerminateCalls += 1;
            return owned.terminate();
          },
        };
        processes.push(tracked);
        return tracked;
      },
    });
    await buildStarted.promise;

    controller.abort();

    try {
      await expect(settleWithin(running)).resolves.toBe(0);
      expect(buildSignal?.aborted).toBe(true);
      expect(serverTerminateCalls).toBe(1);
      await expect(fs.stat(path.join(projectDir, ".localapp/dev-config.json"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      buildRelease.resolve(fakePackageResult(path.join(fixtureRoot, "released.localapp")));
      await settleWithin(running).catch(() => undefined);
    }
  });

  it("awaits a Server acquired after abort cleanup has already started", async () => {
    // Break caught: re-entrant abort during spawn can settle empty cleanup before own() registers the newly acquired process.
    const projectDir = await fixtureProject();
    const fixtureRoot = path.join(projectDir, "tmp/localapp-dev/fixtures");
    await fs.mkdir(fixtureRoot, { recursive: true });
    const serverLauncher = path.join(fixtureRoot, "late-owned-server.mjs");
    await fs.writeFile(serverLauncher, "setInterval(() => {}, 1000);\n");
    const controller = new AbortController();
    const terminateStarted = deferred<void>();
    const terminateRelease = deferred<void>();
    let terminateCalls = 0;
    const running = runDev({ projectDir, signal: controller.signal, io: captureIo().io }, {
      serverLauncher,
      buildApplicationPackage: fakePackageBuilder(fixtureRoot),
      spawnOwnedProcess: (...args) => {
        const owned = spawnOwnedProcess(...args);
        processes.push(owned);
        controller.abort();
        return {
          ...owned,
          terminate() {
            terminateCalls += 1;
            terminateStarted.resolve();
            return terminateRelease.promise.then(() => owned.terminate());
          },
        };
      },
    });

    try {
      await expect(settleWithin(terminateStarted.promise, 500)).resolves.toBeUndefined();
      await expect(isSettled(running)).resolves.toBe(false);
      expect(terminateCalls).toBe(1);
      terminateRelease.resolve();
      await expect(settleWithin(running)).resolves.toBe(0);
    } finally {
      terminateRelease.resolve();
      await settleWithin(running, 5_000).catch(() => undefined);
    }
  });

  it("keeps the original abort cleanup promise open for ownership acquired before sealing", async () => {
    // Break caught: a settled empty cleanup promise cannot supervise a process acquired in an abort race.
    const projectDir = await fixtureProject();
    const lifecycle = new DevLifecycle();
    lifecycle.abort();
    const cleanup = lifecycle.cleanup();
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(await isSettled(cleanup)).toBe(false);

    const late = spawnOwnedProcess(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      cwd: projectDir,
      stdio: "ignore",
    });
    processes.push(late);
    lifecycle.own(late);
    lifecycle.sealOwnership();

    await expect(settleWithin(cleanup)).resolves.toBeUndefined();
    await expect(waitForProcessExit(late.pid)).resolves.toBe(true);
  });

  it.each(["external-abort", "server-exit"] as const)("keeps the first %s stop reason when external abort and Server exit race in one turn", async (firstReason) => {
    // Break caught: a later stop callback must not overwrite the reason that woke runPhase and selected the public exit behavior.
    const lifecycle = new DevLifecycle();
    const phaseRelease = deferred<void>();
    const phase = lifecycle.runPhase(() => phaseRelease.promise);
    const phaseOutcome = phase.then(
      () => "fulfilled" as const,
      () => "rejected" as const,
    );

    if (firstReason === "external-abort") {
      const serverExit = deferred<{ code: number | null; signal: NodeJS.Signals | null }>();
      lifecycle.observeServerExit({ exited: serverExit.promise } as OwnedProcess);
      lifecycle.abort();
      serverExit.resolve({ code: 1, signal: null });
    } else {
      lifecycle.observeServerExit({
        exited: Promise.resolve({ code: 1, signal: null }),
      } as OwnedProcess);
      queueMicrotask(() => lifecycle.abort());
    }

    await new Promise<void>((resolve) => setImmediate(resolve));
    lifecycle.sealOwnership();
    await lifecycle.cleanup();

    expect(await phaseOutcome).toBe("rejected");
    expect(lifecycle.stopReason).toBe(firstReason);
    phaseRelease.resolve();
    await new Promise<void>((resolve) => setImmediate(resolve));
  });

  it("cancels a blocked Server initialization fetch and settles after Server cleanup", async () => {
    // Break caught: setup fetch without the lifecycle signal can hold runDev and the owned Server open after abort.
    const projectDir = await fixtureProject();
    const fixtureRoot = path.join(projectDir, "tmp/localapp-dev/fixtures");
    await fs.mkdir(fixtureRoot, { recursive: true });
    const serverLauncher = await writeFakeServer(fixtureRoot);
    const controller = new AbortController();
    const fetchStarted = deferred<void>();
    const blocked = deferred<Response>();
    let fetchSignal: AbortSignal | undefined;
    let spawnCalls = 0;
    vi.stubGlobal("fetch", (_input: URL | RequestInfo, init?: RequestInit) => {
      fetchSignal = init?.signal ?? undefined;
      fetchStarted.resolve();
      fetchSignal?.addEventListener("abort", () => blocked.reject(new DOMException("Aborted", "AbortError")), { once: true });
      return blocked.promise;
    });
    const running = runDev({ projectDir, signal: controller.signal, io: captureIo().io }, {
      serverLauncher,
      buildApplicationPackage: fakePackageBuilder(fixtureRoot),
      spawnOwnedProcess: (...args) => {
        spawnCalls += 1;
        const owned = spawnOwnedProcess(...args);
        processes.push(owned);
        return owned;
      },
    });
    await fetchStarted.promise;

    controller.abort();

    try {
      await expect(settleWithin(running)).resolves.toBe(0);
      expect(fetchSignal?.aborted).toBe(true);
      expect(spawnCalls).toBe(1);
      await expect(fs.stat(path.join(projectDir, ".localapp/dev-config.json"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      blocked.reject(new Error("release initialization fetch"));
      await settleWithin(running).catch(() => undefined);
    }
  });

  it("wakes from an install fetch that ignores abort without publishing config or Vite", async () => {
    // Break caught: even an abort-ignoring fetch implementation must not hold runDev or let its late result advance startup.
    const projectDir = await fixtureProject();
    const fixtureRoot = path.join(projectDir, "tmp/localapp-dev/fixtures");
    await fs.mkdir(fixtureRoot, { recursive: true });
    const serverLauncher = await writeFakeServer(fixtureRoot);
    const controller = new AbortController();
    const installStarted = deferred<void>();
    const blocked = deferred<Response>();
    let installSignal: AbortSignal | undefined;
    let spawnCalls = 0;
    blockedFetches.push((error) => blocked.reject(error));
    vi.stubGlobal("fetch", (input: URL | RequestInfo, init?: RequestInit) => {
      if (String(input).endsWith("/api/setup/initialize")) {
        return Promise.resolve({ status: 201 } as Response);
      }
      installSignal = init?.signal ?? undefined;
      installStarted.resolve();
      return blocked.promise;
    });
    const running = runDev({ projectDir, signal: controller.signal, io: captureIo().io }, {
      serverLauncher,
      buildApplicationPackage: fakePackageBuilder(fixtureRoot),
      spawnOwnedProcess: (...args) => {
        spawnCalls += 1;
        const owned = spawnOwnedProcess(...args);
        processes.push(owned);
        return owned;
      },
    });
    await installStarted.promise;

    controller.abort();

    try {
      await expect(settleWithin(running)).resolves.toBe(0);
      expect(installSignal?.aborted).toBe(true);
      expect(spawnCalls).toBe(1);
      await expect(fs.stat(path.join(projectDir, ".localapp/dev-config.json"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      blocked.reject(new Error("release install fetch"));
      await settleWithin(running).catch(() => undefined);
    }
  });

  it("lets abort win a concurrent config-phase rejection without spawning Vite or leaking rejection", async () => {
    // Break caught: a phase completion racing abort can publish Vite, while an abandoned phase rejection can become unhandled.
    const projectDir = await fixtureProject();
    const fixtureRoot = path.join(projectDir, "tmp/localapp-dev/fixtures");
    await fs.mkdir(fixtureRoot, { recursive: true });
    const serverLauncher = await writeFakeServer(fixtureRoot);
    const controller = new AbortController();
    const unhandled: unknown[] = [];
    const onUnhandled = (error: unknown) => unhandled.push(error);
    let configPhaseCalled = false;
    let spawnCalls = 0;
    process.on("unhandledRejection", onUnhandled);
    const dependencies: RunDevDependencies = {
      serverLauncher,
      buildApplicationPackage: fakePackageBuilder(fixtureRoot),
      writeDevConfig: async () => {
        configPhaseCalled = true;
        controller.abort();
        await Promise.resolve();
        throw new Error("late config phase rejection");
      },
      spawnOwnedProcess: (...args) => {
        spawnCalls += 1;
        const owned = spawnOwnedProcess(...args);
        processes.push(owned);
        return owned;
      },
    };

    try {
      await expect(settleWithin(runDev({ projectDir, signal: controller.signal, io: captureIo().io }, dependencies))).resolves.toBe(0);
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(configPhaseCalled).toBe(true);
      expect(spawnCalls).toBe(1);
      expect(unhandled).toEqual([]);
      await expect(fs.stat(path.join(projectDir, ".localapp/dev-config.json"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it.skipIf(process.platform === "win32")("terminates the package build command and its stubborn descendant on abort", async () => {
    // Break caught: raw package-manager spawn leaves test/build descendants alive after the dev Server cleanup begins.
    const fixture = await fixtureBuildProject();
    const fixtureRoot = path.join(fixture.projectDir, "tmp/localapp-dev/fixtures");
    await fs.mkdir(fixtureRoot, { recursive: true });
    const serverLauncher = await writeFakeServer(fixtureRoot);
    const controller = new AbortController();
    let spawnCalls = 0;
    const running = runDev({ projectDir: fixture.projectDir, signal: controller.signal, io: captureIo().io }, {
      serverLauncher,
      spawnOwnedProcess: (...args) => {
        spawnCalls += 1;
        const owned = spawnOwnedProcess(...args);
        processes.push(owned);
        return owned;
      },
    });
    const buildPids = JSON.parse(await waitForFile(fixture.pidsPath)) as number[];

    controller.abort();

    try {
      await expect(settleWithin(running, 2_000)).resolves.toBe(0);
      expect(spawnCalls).toBe(2);
      for (const pid of buildPids) await expect(waitForProcessExit(pid)).resolves.toBe(true);
      await expect(fs.stat(path.join(fixtureRoot, "vite.json"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await fs.writeFile(fixture.cleanupPath, "stop\n").catch(() => undefined);
      await settleWithin(running, 5_000).catch(() => undefined);
    }
  });

  it.skipIf(process.platform === "win32")("fails promptly when the ready Server exits during a real package build and cleans the stubborn build tree", async () => {
    // Break caught: post-readiness startup that does not supervise Server exit leaves the real build tree alive and runDev pending.
    const fixture = await fixtureBuildProject();
    const fixtureRoot = path.join(fixture.projectDir, "tmp/localapp-dev/fixtures");
    await fs.mkdir(fixtureRoot, { recursive: true });
    const serverLauncher = await writeFakeServer(fixtureRoot);
    const viteLauncher = await writeFakeVite(fixtureRoot, false);
    const output = captureIo();
    let spawnCalls = 0;
    const running = runDev({ projectDir: fixture.projectDir, signal: new AbortController().signal, io: output.io }, {
      serverLauncher,
      viteCommand: { command: process.execPath, args: [viteLauncher] },
      spawnOwnedProcess: (...args) => {
        spawnCalls += 1;
        const owned = spawnOwnedProcess(...args);
        processes.push(owned);
        return owned;
      },
    });
    const buildPids = JSON.parse(await waitForFile(fixture.pidsPath)) as number[];
    const serverState = JSON.parse(await fs.readFile(path.join(fixtureRoot, "server.json"), "utf8")) as { pid: number };

    process.kill(serverState.pid, "SIGKILL");

    try {
      expect(buildPids).toHaveLength(2);
      await expect(settleWithin(running, 2_000)).resolves.toBe(1);
      expect(spawnCalls).toBe(2);
      for (const pid of buildPids) await expect(waitForProcessExit(pid)).resolves.toBe(true);
      expect(output.stderr).toContain("Local Server exited unexpectedly");
      await expect(fs.stat(path.join(fixture.projectDir, ".localapp/dev-config.json"))).rejects.toMatchObject({ code: "ENOENT" });
      await expect(fs.stat(path.join(fixtureRoot, "vite.json"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await fs.writeFile(fixture.cleanupPath, "stop\n").catch(() => undefined);
      await settleWithin(running, 5_000).catch(() => undefined);
    }
  });

  it.each(["fulfills", "rejects"] as const)("fails promptly when the ready Server exits during an install that later %s", async (lateOutcome) => {
    // Break caught: Server exit must wake an abort-ignoring install, and both forms of late settlement must stay observed and inert.
    const projectDir = await fixtureProject();
    const fixtureRoot = path.join(projectDir, "tmp/localapp-dev/fixtures");
    await fs.mkdir(fixtureRoot, { recursive: true });
    const serverLauncher = await writeFakeServer(fixtureRoot);
    const viteLauncher = await writeFakeVite(fixtureRoot, false);
    const installStarted = deferred<void>();
    const installRelease = deferred<void>();
    const unhandled: unknown[] = [];
    const onUnhandled = (error: unknown) => unhandled.push(error);
    const output = captureIo();
    let installSignal: AbortSignal | undefined;
    let spawnCalls = 0;
    process.on("unhandledRejection", onUnhandled);
    const running = runDev({ projectDir, signal: new AbortController().signal, io: output.io }, {
      serverLauncher,
      viteCommand: { command: process.execPath, args: [viteLauncher] },
      buildApplicationPackage: fakePackageBuilder(fixtureRoot),
      installDevPackage: async (_serverUrl, _apiKey, _packagePath, signal) => {
        installSignal = signal;
        installStarted.resolve();
        return installRelease.promise;
      },
      spawnOwnedProcess: (...args) => {
        spawnCalls += 1;
        const owned = spawnOwnedProcess(...args);
        processes.push(owned);
        return owned;
      },
    });

    try {
      await installStarted.promise;
      const serverState = JSON.parse(await fs.readFile(path.join(fixtureRoot, "server.json"), "utf8")) as { pid: number };
      process.kill(serverState.pid, "SIGKILL");

      await expect(settleWithin(running, 1_500)).resolves.toBe(1);
      expect(installSignal?.aborted).toBe(true);
      expect(spawnCalls).toBe(1);
      expect(output.stderr).toContain("Local Server exited unexpectedly");

      if (lateOutcome === "fulfills") installRelease.resolve();
      else installRelease.reject(new Error("late install rejection"));
      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(unhandled).toEqual([]);
      expect(spawnCalls).toBe(1);
      await expect(fs.stat(path.join(projectDir, ".localapp/dev-config.json"))).rejects.toMatchObject({ code: "ENOENT" });
      await expect(fs.stat(path.join(fixtureRoot, "vite.json"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      installRelease.resolve();
      process.off("unhandledRejection", onUnhandled);
      await settleWithin(running, 5_000).catch(() => undefined);
    }
  });

  it("fails closed when abort cleanup cannot confirm an owned process tree exited", async () => {
    // Break caught: runDev catches terminate rejection with allSettled and returns abort success even though process ownership is unresolved.
    const projectDir = await fixtureProject();
    const fixtureRoot = path.join(projectDir, "tmp/localapp-dev/fixtures");
    await fs.mkdir(fixtureRoot, { recursive: true });
    const serverLauncher = path.join(fixtureRoot, "cleanup-failure-server.mjs");
    const pidPath = path.join(fixtureRoot, "cleanup-failure-server.pid");
    await fs.writeFile(serverLauncher, `
      import fs from "node:fs";
      fs.writeFileSync(${JSON.stringify(pidPath)}, String(process.pid));
      setInterval(() => {}, 1000);
    `);
    const credentials = await readOrCreateDevCredentials(projectDir);
    const controller = new AbortController();
    const output = captureIo();
    const cleanupFailure = Object.assign(new Error(`cleanup failed ${credentials.apiKey}`), {
      code: "owned_process_tree_exit_unconfirmed",
    });
    const running = runDev({ projectDir, signal: controller.signal, io: output.io }, {
      serverLauncher,
      readyTimeoutMs: 5_000,
      buildApplicationPackage: fakePackageBuilder(fixtureRoot),
      spawnOwnedProcess: (...args: Parameters<typeof spawnOwnedProcess>) => {
        const owned = spawnOwnedProcess(...args);
        let termination: Promise<void> | undefined;
        return {
          ...owned,
          terminate() {
            termination ??= owned.terminate().then(() => { throw cleanupFailure; });
            return termination;
          },
        };
      },
    });
    const pid = Number(await waitForFile(pidPath));

    controller.abort();

    await expect(running).rejects.toMatchObject({
      code: "owned_process_tree_exit_unconfirmed",
      message: expect.not.stringContaining(credentials.apiKey),
    });
    await expect(waitForProcessExit(pid)).resolves.toBe(true);
    expect(output.stdout + output.stderr).not.toContain(credentials.apiKey);
  });

  it("builds and installs a unique package before loopback Vite, then abort cleans both trees without leaking credentials", async () => {
    // Break caught: starting Vite before canonical install serves stale APIs, and leader-only abort cleanup leaves Server/Vite descendants alive.
    const projectDir = await fixtureProject();
    const fixtureRoot = path.join(projectDir, "tmp/localapp-dev/fixtures");
    await fs.mkdir(fixtureRoot, { recursive: true });
    const serverLauncher = await writeFakeServer(fixtureRoot);
    const viteLauncher = await writeFakeVite(fixtureRoot, false);
    const controller = new AbortController();
    const output = captureIo();
    const invocation = runDev({ projectDir, signal: controller.signal, io: output.io }, {
      serverLauncher,
      viteCommand: { command: process.execPath, args: [viteLauncher] },
      buildApplicationPackage: fakePackageBuilder(fixtureRoot),
    });
    const viteStatePath = path.join(fixtureRoot, "vite.json");
    const viteState = JSON.parse(await waitForFile(viteStatePath)) as { pid: number; config: Record<string, unknown>; args: string[] };
    const serverState = JSON.parse(await fs.readFile(path.join(fixtureRoot, "server.json"), "utf8")) as { pid: number; host: string; port: number; args: string[] };
    const installState = JSON.parse(await fs.readFile(path.join(fixtureRoot, "install.json"), "utf8")) as { authenticated: boolean; bytes: number };
    const packageState = JSON.parse(await fs.readFile(path.join(fixtureRoot, "package.json"), "utf8")) as { outputPath: string; versionOverride: string };
    const credentials = await readOrCreateDevCredentials(projectDir);

    expect(serverState).toMatchObject({ host: "127.0.0.1", port: 0 });
    expect(serverState.args).toEqual([
      "start", "--data-dir", path.join(projectDir, "tmp/localapp-dev/server"), "--host", "127.0.0.1", "--port", "0",
    ]);
    expect(installState.authenticated).toBe(true);
    expect(installState.bytes).toBeGreaterThan(0);
    expect(packageState.outputPath.startsWith(path.join(projectDir, "tmp/localapp-dev/packages"))).toBe(true);
    expect(packageState.versionOverride).toMatch(/^0\.0\.0-dev\./);
    expect(viteState.config).toEqual({
      serverUrl: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+$/),
      userId: "dev-user",
      pageName: "task-six-app",
      appServerPort: expect.any(Number),
    });
    expect(viteState.args).toContain("127.0.0.1");
    expect(JSON.stringify(viteState)).not.toContain(credentials.apiKey);
    expect(output.stdout + output.stderr).not.toContain(credentials.apiKey);
    expect(output.stdout + output.stderr).not.toContain(credentials.password);
    expect(output.stdout + output.stderr).not.toContain(credentials.jwtSecret);

    controller.abort();
    await expect(invocation).resolves.toBe(0);
    await expect(waitForProcessExit(serverState.pid)).resolves.toBe(true);
    await expect(waitForProcessExit(viteState.pid)).resolves.toBe(true);
  });

  it("keeps successful startup authoritative when the Server exits only during sealed cleanup", async () => {
    // Break caught: intentional cleanup after a successful Vite outcome must not manufacture an unexpected-Server failure.
    const projectDir = await fixtureProject();
    const fixtureRoot = path.join(projectDir, "tmp/localapp-dev/fixtures");
    await fs.mkdir(fixtureRoot, { recursive: true });
    const serverLauncher = await writeFakeServer(fixtureRoot);
    const viteLauncher = await writeFakeVite(fixtureRoot, true, 0);
    const output = captureIo();

    const code = await runDev({ projectDir, signal: new AbortController().signal, io: output.io }, {
      serverLauncher,
      viteCommand: { command: process.execPath, args: [viteLauncher] },
      buildApplicationPackage: fakePackageBuilder(fixtureRoot),
    });

    const serverState = JSON.parse(await fs.readFile(path.join(fixtureRoot, "server.json"), "utf8")) as { pid: number };
    expect(code).toBe(0);
    expect(output.stderr).not.toContain("Local Server exited unexpectedly");
    await expect(waitForProcessExit(serverState.pid)).resolves.toBe(true);
  });

  it("a Vite exit terminates the still-running Server tree", async () => {
    // Break caught: supervising only interrupts leaves the canonical Server orphaned when one child exits by itself.
    const projectDir = await fixtureProject();
    const fixtureRoot = path.join(projectDir, "tmp/localapp-dev/fixtures");
    await fs.mkdir(fixtureRoot, { recursive: true });
    const serverLauncher = await writeFakeServer(fixtureRoot);
    const viteLauncher = await writeFakeVite(fixtureRoot, true);
    const output = captureIo();

    const code = await runDev({ projectDir, signal: new AbortController().signal, io: output.io }, {
      serverLauncher,
      viteCommand: { command: process.execPath, args: [viteLauncher] },
      buildApplicationPackage: fakePackageBuilder(fixtureRoot),
    });

    const serverState = JSON.parse(await fs.readFile(path.join(fixtureRoot, "server.json"), "utf8")) as { pid: number };
    expect(code).toBe(1);
    expect(output.stderr).toContain("Vite exited unexpectedly");
    expect(output.stderr).not.toContain("Local Server exited unexpectedly");
    await expect(waitForProcessExit(serverState.pid)).resolves.toBe(true);
  });
});

async function fixtureProject(): Promise<string> {
  const projectDir = await fs.mkdtemp(path.join(testRoot, "project-"));
  directories.push(projectDir);
  await fs.mkdir(path.join(projectDir, ".localapp"), { recursive: true });
  await fs.writeFile(path.join(projectDir, "manifest.json"), `${JSON.stringify({ name: "task-six-app" })}\n`);
  return projectDir;
}

async function fixtureBuildProject(): Promise<{ projectDir: string; cleanupPath: string; pidsPath: string }> {
  const projectDir = await fixtureProject();
  const fixtureRoot = path.join(projectDir, "tmp/localapp-dev/build-fixture");
  const cleanupPath = path.join(fixtureRoot, "cleanup");
  const pidsPath = path.join(fixtureRoot, "pids.json");
  const buildScript = path.join(fixtureRoot, "stubborn-build.mjs");
  const descendantSource = `
    const fs = require("node:fs");
    const cleanupPath = process.argv[1];
    process.on("SIGTERM", () => {});
    setInterval(() => {
      if (fs.existsSync(cleanupPath)) process.exit(0);
    }, 20);
  `;
  await fs.mkdir(path.join(projectDir, "dist"), { recursive: true });
  await fs.mkdir(fixtureRoot, { recursive: true });
  await fs.writeFile(path.join(projectDir, "manifest.json"), `${JSON.stringify({
    name: "task-six-app",
    description: "Task six build fixture",
    distDir: "dist",
    requires: { identity: [], primitives: [] },
    platformVersion: "^1.2",
  }, null, 2)}\n`);
  await fs.writeFile(path.join(projectDir, "package.json"), `${JSON.stringify({
    name: "task-six-build-fixture",
    version: "1.0.0",
    packageManager: "npm@10.0.0",
    scripts: { build: `node ${JSON.stringify(buildScript)}` },
  }, null, 2)}\n`);
  await fs.writeFile(path.join(projectDir, "dist/index.html"), "<main>build fixture</main>\n");
  await fs.writeFile(buildScript, `
    import { spawn } from "node:child_process";
    import fs from "node:fs";
    const cleanupPath = ${JSON.stringify(cleanupPath)};
    const descendant = spawn(process.execPath, ["-e", ${JSON.stringify(descendantSource)}, cleanupPath], { stdio: "ignore" });
    fs.writeFileSync(${JSON.stringify(pidsPath)}, JSON.stringify([process.pid, descendant.pid]));
    process.on("SIGTERM", () => {});
    setInterval(() => {
      if (fs.existsSync(cleanupPath)) process.exit(0);
    }, 20);
  `);
  const fixture = { projectDir, cleanupPath, pidsPath };
  buildFixtures.push(fixture);
  return fixture;
}

async function writeFakeServer(fixtureRoot: string): Promise<string> {
  const filePath = path.join(fixtureRoot, "fake-server.mjs");
  await fs.writeFile(filePath, `
    import fs from "node:fs";
    import http from "node:http";
    import path from "node:path";
    const args = process.argv.slice(2);
    const value = (flag) => args[args.indexOf(flag) + 1];
    const host = value("--host");
    const port = Number(value("--port"));
    const fixtureRoot = ${JSON.stringify(fixtureRoot)};
    fs.writeFileSync(path.join(fixtureRoot, "server.json"), JSON.stringify({ pid: process.pid, host, port, args }));
    const server = http.createServer((request, response) => {
      const chunks = [];
      request.on("data", (chunk) => chunks.push(chunk));
      request.on("end", () => {
        if (request.url === "/api/setup/initialize") {
          fs.writeFileSync(path.join(fixtureRoot, "setup.json"), JSON.stringify({ initialized: true }));
          response.writeHead(201, { "content-type": "application/json" });
          response.end(JSON.stringify({ success: true }));
          return;
        }
        if (request.url === "/api/me/apps/install") {
          fs.writeFileSync(path.join(fixtureRoot, "install.json"), JSON.stringify({
            authenticated: request.headers["x-api-key"] === process.env.BOOTSTRAP_API_KEY,
            bytes: Buffer.concat(chunks).length,
          }));
          response.writeHead(201, { "content-type": "application/json" });
          response.end(JSON.stringify({ success: true, data: { name: "task-six-app" } }));
          return;
        }
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ success: false }));
      });
    });
    server.listen(0, host, () => {
      const address = server.address();
      const listenUrl = \`http://127.0.0.1:\${address.port}\`;
      console.log(JSON.stringify({ type: "ready", listenUrl, url: listenUrl, setupUrl: \`\${listenUrl}/setup?token=fixture-token\` }));
    });
    const stop = () => server.close(() => process.exit(0));
    process.on("SIGTERM", stop);
    process.on("SIGINT", stop);
  `);
  return filePath;
}

async function writeFakeVite(fixtureRoot: string, exitImmediately: boolean, exitCode = 7): Promise<string> {
  const filePath = path.join(fixtureRoot, exitImmediately ? "exiting-vite.mjs" : "fake-vite.mjs");
  await fs.writeFile(filePath, `
    import fs from "node:fs";
    import path from "node:path";
    const fixtureRoot = ${JSON.stringify(fixtureRoot)};
    const config = JSON.parse(fs.readFileSync(path.join(process.cwd(), ".localapp/dev-config.json"), "utf8"));
    if (!fs.existsSync(path.join(fixtureRoot, "install.json"))) process.exit(91);
    if (!process.env.LOCALAPP_DEV_API_KEY) process.exit(92);
    fs.writeFileSync(path.join(fixtureRoot, "vite.json"), JSON.stringify({ pid: process.pid, config, args: process.argv.slice(2) }));
    ${exitImmediately ? `process.exit(${exitCode});` : "setInterval(() => {}, 1000);"}
  `);
  return filePath;
}

function fakePackageBuilder(fixtureRoot: string) {
  return async (options: { outputPath?: string; versionOverride?: string }) => {
    const outputPath = options.outputPath!;
    const versionOverride = options.versionOverride!;
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, "canonical-package-fixture\n", { mode: 0o600 });
    await fs.writeFile(path.join(fixtureRoot, "package.json"), JSON.stringify({ outputPath, versionOverride }));
    return { path: outputPath, appId: "task-six-app", version: versionOverride, sha256: "fixture", size: 26 };
  };
}

function fakePackageResult(packagePath: string) {
  return { path: packagePath, appId: "task-six-app", version: "0.0.0-dev.fixture", sha256: "fixture", size: 26 };
}

function captureIo(): { io: CliIo; stdout: string; stderr: string } {
  const capture = {
    stdout: "",
    stderr: "",
    io: undefined as unknown as CliIo,
  };
  capture.io = {
    stdout: (value) => { capture.stdout += value; },
    stderr: (value) => { capture.stderr += value; },
  };
  return capture;
}

async function waitForFile(filePath: string, timeoutMs = 5_000): Promise<string> {
  return waitForCondition(async () => fs.readFile(filePath, "utf8").catch(() => undefined), `file ${filePath}`, timeoutMs);
}

async function waitForProcessExit(pid: number): Promise<boolean> {
  return waitForCondition(() => {
    try {
      process.kill(pid, 0);
      return false;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "ESRCH";
    }
  }, `process ${pid} exit`, 5_000);
}

async function settleWithin<T>(promise: Promise<T>, timeoutMs = 1_500): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(`runDev did not settle within ${timeoutMs} ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

async function isSettled(promise: Promise<unknown>): Promise<boolean> {
  const pending = Symbol("pending");
  return await Promise.race([
    promise.then(() => true, () => true),
    new Promise<typeof pending>((resolve) => setImmediate(() => resolve(pending))),
  ]) !== pending;
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void } {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function waitForCondition<T>(condition: () => T | undefined | false | Promise<T | undefined | false>, label: string, timeoutMs: number): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await condition();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

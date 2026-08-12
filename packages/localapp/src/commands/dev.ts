import { randomBytes } from "node:crypto";
import { chmodSync, renameSync } from "node:fs";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CliIo } from "../cli/output.js";
import { readOrCreateDevCredentials } from "../dev/credentials.js";
import { lifecycleError } from "../errors.js";
import { LocalAppClient } from "../http/localapp-client.js";
import { spawnOwnedProcess, type OwnedProcess, type WindowsProcessTreeAdapter } from "../process/process-tree.js";
import { waitForServerReady } from "../process/readiness.js";
import type { ProjectCommandRunner } from "../project/check.js";
import { buildApplicationPackage, type BuildApplicationPackageOptions, type BuildApplicationPackageResult } from "../project/package.js";

export interface RunDevOptions {
  projectDir: string;
  signal: AbortSignal;
  io: CliIo;
}

export interface DevCommandInvocation {
  command: string;
  args: string[];
}

export interface RunDevDependencies {
  serverLauncher?: string;
  viteCommand?: DevCommandInvocation;
  readyTimeoutMs?: number;
  buildApplicationPackage?: (options: BuildApplicationPackageOptions) => Promise<BuildApplicationPackageResult>;
  initializeServer?: (serverUrl: string, setupUrl: string | undefined, password: string, signal: AbortSignal) => Promise<void>;
  installDevPackage?: (serverUrl: string, apiKey: string, packagePath: string, signal: AbortSignal) => Promise<void>;
  reserveLoopbackPort?: (signal: AbortSignal) => Promise<number>;
  writeDevConfig?: (options: WriteDevConfigOptions) => Promise<void>;
  spawnOwnedProcess?: typeof spawnOwnedProcess;
  windowsAdapter?: WindowsProcessTreeAdapter;
}

export interface WriteDevConfigOptions {
  projectDir: string;
  serverUrl: string;
  pageName: string;
  appServerPort: number;
  signal?: AbortSignal;
}

const DEV_USER_ID = "dev-user";

export async function runDev(options: RunDevOptions, dependencies: RunDevDependencies = {}): Promise<number> {
  const projectDir = path.resolve(options.projectDir);
  const stateRoot = path.join(projectDir, "tmp/localapp-dev");
  const dataDir = path.join(stateRoot, "server");
  const packagesDir = path.join(stateRoot, "packages");
  const spawnProcess = dependencies.spawnOwnedProcess ?? spawnOwnedProcess;
  const lifecycle = new DevLifecycle();
  const abort = () => lifecycle.abort();
  const onExternalAbort = () => abort();
  options.signal.addEventListener("abort", onExternalAbort, { once: true });
  process.once("SIGINT", abort);
  process.once("SIGTERM", abort);
  if (options.signal.aborted) abort();

  try {
    const manifest = await lifecycle.runPhase(() => readManifest(projectDir));
    const credentials = await lifecycle.runPhase(() => readOrCreateDevCredentials(projectDir));
    await lifecycle.runPhase(async () => {
      await Promise.all([
        fs.mkdir(dataDir, { recursive: true, mode: 0o700 }),
        fs.mkdir(packagesDir, { recursive: true, mode: 0o700 }),
      ]);
    });
    const serverLauncher = dependencies.serverLauncher ?? embeddedServerLauncher();
    if (!await lifecycle.runPhase(() => isFile(serverLauncher))) {
      throw lifecycleError("canonical_server_unavailable", "The packed canonical LocalApp Server runtime is unavailable. Reinstall localapp.");
    }
    lifecycle.assertActive();
    const server = lifecycle.spawn(() => spawnProcess(process.execPath, [
      serverLauncher,
      "start",
      "--data-dir", dataDir,
      "--host", "127.0.0.1",
      "--port", "0",
    ], {
      cwd: projectDir,
      env: {
        ...process.env,
        BOOTSTRAP_API_KEY: credentials.apiKey,
        JWT_SECRET: credentials.jwtSecret,
        LOCALAPP_DEV_TOOLS: "1",
      },
      stdio: ["ignore", "pipe", "ignore"],
      windowsAdapter: dependencies.windowsAdapter,
    }));
    lifecycle.assertActive();
    const ready = await lifecycle.runPhase((signal) => waitForServerReady(server, {
      timeoutMs: dependencies.readyTimeoutMs ?? 15_000,
      signal,
    }));
    lifecycle.observeServerExit(server);
    const initialize = dependencies.initializeServer ?? initializeServer;
    await lifecycle.runPhase((signal) => initialize(ready.listenUrl, ready.setupUrl, credentials.password, signal));

    const version = uniqueDevVersion();
    const packagePath = path.join(packagesDir, `${manifest.name}-${version}.localapp`);
    const build = dependencies.buildApplicationPackage ?? buildApplicationPackage;
    const runBuildCommand = createOwnedProjectCommandRunner(lifecycle, spawnProcess, dependencies.windowsAdapter);
    const applicationPackage = await lifecycle.runPhase((signal) => build({
      projectDir,
      outputPath: packagePath,
      versionOverride: version,
      signal,
      run: runBuildCommand,
    }));
    const install = dependencies.installDevPackage ?? installDevPackage;
    await lifecycle.runPhase((signal) => install(ready.listenUrl, credentials.apiKey, applicationPackage.path, signal));

    const reservePort = dependencies.reserveLoopbackPort ?? reserveLoopbackPort;
    const appServerPort = await lifecycle.runPhase((signal) => reservePort(signal));
    const writeConfig = dependencies.writeDevConfig ?? writeDevConfig;
    await lifecycle.runPhase((signal) => writeConfig({
      projectDir,
      serverUrl: ready.listenUrl,
      pageName: manifest.name,
      appServerPort,
      signal,
    }));
    const configuredVite = dependencies.viteCommand ?? {
      command: process.platform === "win32" ? "npm.cmd" : "npm",
      args: ["run", "dev:vite", "--"],
    };
    const viteArgs = [
      ...configuredVite.args,
      "--host", "127.0.0.1",
      "--port", String(appServerPort),
      "--strictPort",
    ];
    lifecycle.assertActive();
    const vite = lifecycle.spawn(() => spawnProcess(configuredVite.command, viteArgs, {
      cwd: projectDir,
      env: { ...process.env, LOCALAPP_DEV_API_KEY: credentials.apiKey },
      stdio: "ignore",
      windowsAdapter: dependencies.windowsAdapter,
    }));
    lifecycle.assertActive();

    options.io.stdout(`App URL:         http://127.0.0.1:${appServerPort}/\n`);
    options.io.stdout(`Local Server:     ${ready.listenUrl}\n`);
    options.io.stdout(`Server data:      ${dataDir}\n`);
    const outcome = await firstOutcome(server, vite, lifecycle.signal);
    lifecycle.sealOwnership();
    await lifecycle.cleanup();
    if (lifecycle.stopReason === "server-exit" || outcome.kind === "server") {
      options.io.stderr("Local Server exited unexpectedly.\n");
      return 1;
    }
    if (outcome.kind === "abort") return 0;
    if (outcome.kind === "vite" && outcome.code === 0) return 0;
    options.io.stderr("Vite exited unexpectedly.\n");
    return 1;
  } catch (error) {
    lifecycle.sealOwnership();
    const cleanupError = await lifecycle.cleanup().then(
      () => undefined,
      (failure: unknown) => failure,
    );
    if (cleanupError !== undefined) throw safeCleanupFailure(cleanupError);
    if (lifecycle.stopReason === "server-exit") {
      options.io.stderr("Local Server exited unexpectedly.\n");
      return 1;
    }
    if (lifecycle.signal.aborted) return 0;
    if (error instanceof Error && "code" in error) throw error;
    throw lifecycleError("local_development_failed", safeFailureMessage(error));
  } finally {
    options.signal.removeEventListener("abort", onExternalAbort);
    process.off("SIGINT", abort);
    process.off("SIGTERM", abort);
  }
}

export class DevLifecycle {
  private readonly abortController = new AbortController();
  private readonly ownedProcesses = new Set<OwnedProcess>();
  private stoppedBy: "external-abort" | "server-exit" | undefined;
  private ownershipSealed = false;
  private wakeCleanup: (() => void) | undefined;
  private cleanupPromise: Promise<void> | undefined;

  get signal(): AbortSignal {
    return this.abortController.signal;
  }

  get stopReason(): "external-abort" | "server-exit" | undefined {
    return this.stoppedBy;
  }

  abort(): void {
    this.stop("external-abort");
  }

  observeServerExit(server: OwnedProcess): void {
    void server.exited.then(
      () => this.stopForServerExit(),
      () => this.stopForServerExit(),
    );
  }

  assertActive(): void {
    if (this.signal.aborted) throw abortedDevelopment();
  }

  spawn(create: () => OwnedProcess): OwnedProcess {
    this.assertActive();
    if (this.ownershipSealed) throw new Error("Local development process ownership is sealed");
    return this.own(create());
  }

  own(process: OwnedProcess): OwnedProcess {
    if (this.ownershipSealed) throw new Error("Cannot register a local development process after ownership is sealed");
    this.ownedProcesses.add(process);
    this.wakeCleanupLoop();
    if (this.signal.aborted) void this.cleanup();
    return process;
  }

  release(process: OwnedProcess): void {
    this.ownedProcesses.delete(process);
  }

  sealOwnership(): void {
    if (this.ownershipSealed) return;
    this.ownershipSealed = true;
    this.wakeCleanupLoop();
  }

  runPhase<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    this.assertActive();
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const finish = (complete: () => void) => {
        if (settled) return;
        settled = true;
        this.signal.removeEventListener("abort", onAbort);
        complete();
      };
      const onAbort = () => finish(() => reject(abortedDevelopment()));
      this.signal.addEventListener("abort", onAbort, { once: true });
      const pending = Promise.resolve().then(() => operation(this.signal));
      void pending.then(
        (value) => {
          if (this.signal.aborted) onAbort();
          else finish(() => resolve(value));
        },
        (error: unknown) => {
          if (this.signal.aborted) onAbort();
          else finish(() => reject(error));
        },
      );
      if (this.signal.aborted) onAbort();
    });
  }

  cleanup(): Promise<void> {
    if (this.cleanupPromise === undefined) {
      this.cleanupPromise = this.terminateOwnedProcesses();
      void this.cleanupPromise.catch(() => undefined);
    }
    return this.cleanupPromise;
  }

  private async terminateOwnedProcesses(): Promise<void> {
    const attempted = new Set<OwnedProcess>();
    const failures: unknown[] = [];
    while (true) {
      const pending = [...this.ownedProcesses].filter((process) => !attempted.has(process));
      pending.forEach((process) => attempted.add(process));
      if (pending.length > 0) {
        try {
          await terminateDevProcesses(pending);
        } catch (error) {
          failures.push(error);
        }
      }
      const hasUnattemptedProcess = [...this.ownedProcesses].some((process) => !attempted.has(process));
      if (hasUnattemptedProcess) continue;
      if (this.ownershipSealed) break;
      await this.waitForOwnershipChange(attempted);
    }
    if (failures.length === 0) return;
    if (failures.some((failure) => isErrorCode(failure, "owned_process_tree_exit_unconfirmed"))) {
      throw lifecycleError(
        "owned_process_tree_exit_unconfirmed",
        "Local development could not confirm that all owned process trees exited",
      );
    }
    throw lifecycleError("local_development_cleanup_failed", "Local development could not clean up all owned process trees");
  }

  private waitForOwnershipChange(attempted: ReadonlySet<OwnedProcess>): Promise<void> {
    return new Promise((resolve) => {
      this.wakeCleanup = resolve;
      if (this.ownershipSealed || [...this.ownedProcesses].some((process) => !attempted.has(process))) {
        this.wakeCleanupLoop();
      }
    });
  }

  private wakeCleanupLoop(): void {
    const wake = this.wakeCleanup;
    this.wakeCleanup = undefined;
    wake?.();
  }

  private stopForServerExit(): void {
    if (this.ownershipSealed || this.stoppedBy !== undefined) return;
    this.stop("server-exit");
  }

  private stop(reason: "external-abort" | "server-exit"): void {
    if (this.stoppedBy !== undefined) return;
    this.stoppedBy = reason;
    if (!this.signal.aborted) this.abortController.abort();
    void this.cleanup();
  }
}

function createOwnedProjectCommandRunner(
  lifecycle: DevLifecycle,
  spawnProcess: typeof spawnOwnedProcess,
  windowsAdapter: WindowsProcessTreeAdapter | undefined,
): ProjectCommandRunner {
  return async (invocation) => {
    lifecycle.assertActive();
    const command = process.platform === "win32" ? `${invocation.command}.cmd` : invocation.command;
    const child = lifecycle.spawn(() => spawnProcess(command, invocation.args, {
      cwd: invocation.cwd,
      stdio: "ignore",
      windowsAdapter,
    }));
    try {
      const exit = await lifecycle.runPhase(() => child.exited);
      await child.terminate();
      lifecycle.release(child);
      return { exitCode: exit.code ?? 1, stdout: "", stderr: "" };
    } finally {
      if (lifecycle.signal.aborted) void lifecycle.cleanup();
    }
  };
}

async function terminateDevProcesses(processes: readonly OwnedProcess[]): Promise<void> {
  const results = await Promise.allSettled(
    processes.map((process) => process.terminate()),
  );
  const failures = results
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map((result) => result.reason as unknown);
  if (failures.length === 0) return;
  if (failures.some((failure) => isErrorCode(failure, "owned_process_tree_exit_unconfirmed"))) {
    throw lifecycleError(
      "owned_process_tree_exit_unconfirmed",
      "Local development could not confirm that all owned process trees exited",
    );
  }
  throw lifecycleError("local_development_cleanup_failed", "Local development could not clean up all owned process trees");
}

function abortedDevelopment(): Error {
  return new Error("Local development aborted");
}

function safeCleanupFailure(error: unknown): Error {
  if (isErrorCode(error, "owned_process_tree_exit_unconfirmed")) {
    return lifecycleError(
      "owned_process_tree_exit_unconfirmed",
      "Local development could not confirm that all owned process trees exited",
    );
  }
  return lifecycleError("local_development_cleanup_failed", "Local development could not clean up all owned process trees");
}

function isErrorCode(value: unknown, code: string): boolean {
  return value instanceof Error && "code" in value && value.code === code;
}

export async function writeDevConfig(options: WriteDevConfigOptions): Promise<void> {
  throwIfAborted(options.signal);
  const projectDir = path.resolve(options.projectDir);
  const localAppDir = path.join(projectDir, ".localapp");
  const stateRoot = path.join(projectDir, "tmp/localapp-dev");
  await Promise.all([
    fs.mkdir(localAppDir, { recursive: true }),
    fs.mkdir(stateRoot, { recursive: true, mode: 0o700 }),
  ]);
  const temporary = path.join(stateRoot, `dev-config.${process.pid}.${randomBytes(8).toString("hex")}.next`);
  const destination = path.join(localAppDir, "dev-config.json");
  const value = {
    serverUrl: options.serverUrl,
    userId: DEV_USER_ID,
    pageName: options.pageName,
    appServerPort: options.appServerPort,
  };
  try {
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      flag: "wx",
      mode: 0o600,
      signal: options.signal,
    });
    throwIfAborted(options.signal);
    renameSync(temporary, destination);
    if (process.platform !== "win32") chmodSync(destination, 0o600);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

function embeddedServerLauncher(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../runtime/server/bin/server.mjs");
}

async function readManifest(projectDir: string): Promise<{ name: string }> {
  let value: unknown;
  try { value = JSON.parse(await fs.readFile(path.join(projectDir, "manifest.json"), "utf8")); }
  catch { throw lifecycleError("project_manifest_missing", "No valid manifest.json found. Run 'localapp init' first."); }
  const name = isRecord(value) ? value.name : undefined;
  if (typeof name !== "string" || !name.trim()) throw lifecycleError("project_manifest_invalid", "manifest.json must contain an application name");
  return { name: name.trim() };
}

async function initializeServer(
  serverUrl: string,
  setupUrl: string | undefined,
  password: string,
  signal: AbortSignal,
): Promise<void> {
  if (setupUrl === undefined) return;
  let url: URL;
  try { url = new URL(setupUrl); }
  catch { throw lifecycleError("local_server_setup_failed", "Local Server setup event was invalid"); }
  const token = url.searchParams.get("token");
  if (url.origin !== serverUrl || url.pathname !== "/setup" || !token) {
    throw lifecycleError("local_server_setup_failed", "Local Server setup event was invalid");
  }
  let response: Response;
  try {
    response = await fetch(`${serverUrl}/api/setup/initialize`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, username: DEV_USER_ID, password }),
      signal,
    });
  } catch {
    throw lifecycleError("local_server_setup_failed", "Could not initialize the local Server");
  }
  if (response.status !== 201) throw lifecycleError("local_server_setup_failed", "Could not initialize the local Server");
}

async function installDevPackage(serverUrl: string, apiKey: string, packagePath: string, signal: AbortSignal): Promise<void> {
  const result = await new LocalAppClient({ serverUrl, apiKey }).installPackage(packagePath, signal);
  if (!result.ok || !isSuccessfulInstall(result.body)) {
    throw lifecycleError("application_install_failed", result.ok ? "Local Server rejected the development package" : result.error);
  }
}

function isSuccessfulInstall(value: unknown): boolean {
  return isRecord(value) && value.success === true && isRecord(value.data) && typeof value.data.name === "string";
}

async function reserveLoopbackPort(signal: AbortSignal): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    let settled = false;
    server.unref();
    const finish = (error?: unknown, port?: number) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      server.removeAllListeners();
      if (error !== undefined) reject(error);
      else resolve(port!);
    };
    const onAbort = () => {
      try {
        server.close(() => finish(abortedDevelopment()));
      } catch {
        finish(abortedDevelopment());
      }
    };
    server.once("error", (error) => finish(error));
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      return;
    }
    server.listen({ host: "127.0.0.1", port: 0, exclusive: true }, () => {
      if (signal.aborted) {
        onAbort();
        return;
      }
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close(() => finish(new Error("Could not reserve a loopback Vite port")));
        return;
      }
      server.close((error) => error ? finish(error) : finish(undefined, address.port));
    });
  });
}

async function firstOutcome(
  server: OwnedProcess,
  vite: OwnedProcess,
  signal: AbortSignal,
): Promise<{ kind: "abort" } | { kind: "server" | "vite"; code: number | null }> {
  if (signal.aborted) return { kind: "abort" };
  return Promise.race([
    server.exited.then((exit) => ({ kind: "server" as const, code: exit.code })),
    vite.exited.then((exit) => ({ kind: "vite" as const, code: exit.code })),
    new Promise<{ kind: "abort" }>((resolve) => signal.addEventListener("abort", () => resolve({ kind: "abort" }), { once: true })),
  ]);
}

function uniqueDevVersion(): string {
  return `0.0.0-dev.${process.pid}.${Date.now()}.${randomBytes(8).toString("hex")}`;
}

function safeFailureMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "Local development failed";
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortedDevelopment();
}

async function isFile(filePath: string): Promise<boolean> {
  return fs.stat(filePath).then((stat) => stat.isFile(), () => false);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

import { randomBytes } from "node:crypto";
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
  spawnOwnedProcess?: typeof spawnOwnedProcess;
  windowsAdapter?: WindowsProcessTreeAdapter;
}

export interface WriteDevConfigOptions {
  projectDir: string;
  serverUrl: string;
  pageName: string;
  appServerPort: number;
}

const DEV_USER_ID = "dev-user";

export async function runDev(options: RunDevOptions, dependencies: RunDevDependencies = {}): Promise<number> {
  const projectDir = path.resolve(options.projectDir);
  const stateRoot = path.join(projectDir, "tmp/localapp-dev");
  const dataDir = path.join(stateRoot, "server");
  const packagesDir = path.join(stateRoot, "packages");
  const manifest = await readManifest(projectDir);
  const credentials = await readOrCreateDevCredentials(projectDir);
  await Promise.all([
    fs.mkdir(dataDir, { recursive: true, mode: 0o700 }),
    fs.mkdir(packagesDir, { recursive: true, mode: 0o700 }),
  ]);
  let server: OwnedProcess | undefined;
  let vite: OwnedProcess | undefined;
  let cleanupPromise: Promise<void> | undefined;
  const cleanup = () => cleanupPromise ??= terminateDevProcesses(vite, server);
  const spawnProcess = dependencies.spawnOwnedProcess ?? spawnOwnedProcess;
  const abortController = new AbortController();
  const abort = () => {
    abortController.abort();
  };
  const onExternalAbort = () => abort();
  options.signal.addEventListener("abort", onExternalAbort, { once: true });
  process.once("SIGINT", abort);
  process.once("SIGTERM", abort);
  if (options.signal.aborted) abort();

  try {
    if (abortController.signal.aborted) return 0;
    const serverLauncher = dependencies.serverLauncher ?? embeddedServerLauncher();
    if (!await isFile(serverLauncher)) {
      throw lifecycleError("canonical_server_unavailable", "The packed canonical LocalApp Server runtime is unavailable. Reinstall localapp.");
    }
    server = spawnProcess(process.execPath, [
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
    });
    const ready = await waitForServerReady(server, {
      timeoutMs: dependencies.readyTimeoutMs ?? 15_000,
      signal: abortController.signal,
    });
    throwIfAborted(abortController.signal);
    await initializeServer(ready.listenUrl, ready.setupUrl, credentials.password);
    throwIfAborted(abortController.signal);

    const version = uniqueDevVersion();
    const packagePath = path.join(packagesDir, `${manifest.name}-${version}.localapp`);
    const build = dependencies.buildApplicationPackage ?? buildApplicationPackage;
    const applicationPackage = await build({
      projectDir,
      outputPath: packagePath,
      versionOverride: version,
    });
    throwIfAborted(abortController.signal);
    await installDevPackage(ready.listenUrl, credentials.apiKey, applicationPackage.path);
    throwIfAborted(abortController.signal);

    const appServerPort = await reserveLoopbackPort();
    await writeDevConfig({
      projectDir,
      serverUrl: ready.listenUrl,
      pageName: manifest.name,
      appServerPort,
    });
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
    vite = spawnProcess(configuredVite.command, viteArgs, {
      cwd: projectDir,
      env: { ...process.env, LOCALAPP_DEV_API_KEY: credentials.apiKey },
      stdio: "ignore",
      windowsAdapter: dependencies.windowsAdapter,
    });

    options.io.stdout(`App URL:         http://127.0.0.1:${appServerPort}/\n`);
    options.io.stdout(`Local Server:     ${ready.listenUrl}\n`);
    options.io.stdout(`Server data:      ${dataDir}\n`);
    const outcome = await firstOutcome(server, vite, abortController.signal);
    await cleanup();
    if (outcome.kind === "abort") return 0;
    if (outcome.kind === "vite" && outcome.code === 0) return 0;
    options.io.stderr(`${outcome.kind === "server" ? "Local Server" : "Vite"} exited unexpectedly.\n`);
    return 1;
  } catch (error) {
    const cleanupError = await cleanup().then(
      () => undefined,
      (failure: unknown) => failure,
    );
    if (cleanupError !== undefined) throw safeCleanupFailure(cleanupError);
    if (abortController.signal.aborted) return 0;
    if (error instanceof Error && "code" in error) throw error;
    throw lifecycleError("local_development_failed", safeFailureMessage(error));
  } finally {
    options.signal.removeEventListener("abort", onExternalAbort);
    process.off("SIGINT", abort);
    process.off("SIGTERM", abort);
  }
}

async function terminateDevProcesses(vite: OwnedProcess | undefined, server: OwnedProcess | undefined): Promise<void> {
  const results = await Promise.allSettled(
    [vite, server].filter((process): process is OwnedProcess => process !== undefined).map((process) => process.terminate()),
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
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    await fs.rename(temporary, destination);
    if (process.platform !== "win32") await fs.chmod(destination, 0o600);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

function embeddedServerLauncher(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../runtime/server/bin/localapp-server.mjs");
}

async function readManifest(projectDir: string): Promise<{ name: string }> {
  let value: unknown;
  try { value = JSON.parse(await fs.readFile(path.join(projectDir, "manifest.json"), "utf8")); }
  catch { throw lifecycleError("project_manifest_missing", "No valid manifest.json found. Run 'localapp init' first."); }
  const name = isRecord(value) ? value.name : undefined;
  if (typeof name !== "string" || !name.trim()) throw lifecycleError("project_manifest_invalid", "manifest.json must contain an application name");
  return { name: name.trim() };
}

async function initializeServer(serverUrl: string, setupUrl: string | undefined, password: string): Promise<void> {
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
    });
  } catch {
    throw lifecycleError("local_server_setup_failed", "Could not initialize the local Server");
  }
  if (response.status !== 201) throw lifecycleError("local_server_setup_failed", "Could not initialize the local Server");
}

async function installDevPackage(serverUrl: string, apiKey: string, packagePath: string): Promise<void> {
  const result = await new LocalAppClient({ serverUrl, apiKey }).installPackage(packagePath);
  if (!result.ok || !isSuccessfulInstall(result.body)) {
    throw lifecycleError("application_install_failed", result.ok ? "Local Server rejected the development package" : result.error);
  }
}

function isSuccessfulInstall(value: unknown): boolean {
  return isRecord(value) && value.success === true && isRecord(value.data) && typeof value.data.name === "string";
}

async function reserveLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0, exclusive: true }, () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        reject(new Error("Could not reserve a loopback Vite port"));
        return;
      }
      server.close((error) => error ? reject(error) : resolve(address.port));
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

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new Error("Local development aborted");
}

async function isFile(filePath: string): Promise<boolean> {
  return fs.stat(filePath).then((stat) => stat.isFile(), () => false);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

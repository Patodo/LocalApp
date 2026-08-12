import { spawn, type ChildProcess, type SpawnOptions, type StdioOptions } from "node:child_process";
import { createWindowsProcessTreeAdapterFromEnvironment } from "../native/native-adapter.js";

export interface OwnedProcessExit {
  code: number | null;
  /** Unix forced cleanup may synthesize SIGKILL at dispatch; that records supervisor action, not an OS-observed command status. */
  signal: NodeJS.Signals | null;
  error?: Error;
}

export interface OwnedProcess {
  readonly child: ChildProcess;
  readonly pid: number;
  readonly exited: Promise<OwnedProcessExit>;
  terminate(): Promise<void>;
}

export interface UnixOwnedProcessHandle {
  readonly child: ChildProcess;
  readonly commandExited: Promise<OwnedProcessExit>;
  readonly guardianExited: Promise<OwnedProcessExit>;
  signalOwnedTree(force: boolean): "signaled" | "ownership-lost" | Promise<"signaled" | "ownership-lost">;
  /** Read-only post-force liveness observation. Implementations must never signal from this method. */
  ownedGroupExists(): boolean | Promise<boolean>;
  dispose?(): void | Promise<void>;
}

export interface UnixProcessTreeAdapter {
  /** The handle must signal through a live, non-reusable ownership identity, never a cached numeric PGID. */
  spawnOwned(command: string, args: readonly string[], options: SpawnOptions): UnixOwnedProcessHandle;
}

export interface WindowsOwnedProcessHandle {
  readonly child: ChildProcess;
  treeExists(): boolean | Promise<boolean>;
  signalTree(force: boolean): void | Promise<void>;
  dispose?(): void | Promise<void>;
}

export interface WindowsProcessTreeAdapter {
  /** Task 8 must create a suspended root, assign it to a kill-on-close Job Object, then resume it atomically. */
  spawnOwned(command: string, args: readonly string[], options: SpawnOptions): WindowsOwnedProcessHandle;
}

export interface SpawnOwnedProcessOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdio?: StdioOptions;
  platform?: NodeJS.Platform;
  unixAdapter?: UnixProcessTreeAdapter;
  windowsAdapter?: WindowsProcessTreeAdapter;
  gracefulTimeoutMs?: number;
  forceTimeoutMs?: number;
}

const DEFAULT_GRACEFUL_TIMEOUT_MS = 250;
const DEFAULT_FORCE_TIMEOUT_MS = 3_000;

export function spawnOwnedProcess(
  command: string,
  args: readonly string[],
  options: SpawnOwnedProcessOptions = {},
): OwnedProcess {
  const platform = options.platform ?? process.platform;
  const spawnOptions: SpawnOptions = {
    cwd: options.cwd,
    env: options.env,
    stdio: options.stdio ?? "inherit",
    shell: false,
    windowsHide: true,
  };

  if (platform === "win32") {
    const windowsAdapter = options.windowsAdapter ?? createWindowsProcessTreeAdapterFromEnvironment();
    if (windowsAdapter === undefined) {
      throw new Error("Windows process-tree adapter is unavailable; refusing to spawn without atomic Job Object ownership");
    }
    return ownedWindowsProcess(windowsAdapter.spawnOwned(command, args, spawnOptions), options);
  }

  const adapter = options.unixAdapter ?? nodeUnixProcessTreeAdapter;
  return ownedUnixProcess(adapter.spawnOwned(command, args, spawnOptions), options);
}

function ownedUnixProcess(handle: UnixOwnedProcessHandle, options: SpawnOwnedProcessOptions): OwnedProcess {
  const pid = requireSafeRootPid(handle.child.pid);
  let exitSettled = false;
  let settleExit!: (exit: OwnedProcessExit) => void;
  const exited = new Promise<OwnedProcessExit>((resolve) => { settleExit = resolve; });
  const settleOnce = (exit: OwnedProcessExit) => {
    if (exitSettled) return;
    exitSettled = true;
    settleExit(exit);
  };
  void handle.commandExited.then(
    settleOnce,
    (error: unknown) => settleOnce({ code: null, signal: null, error: asError(error) }),
  );
  let termination: Promise<void> | undefined;
  return {
    child: handle.child,
    pid,
    exited,
    terminate() {
      termination ??= terminateUnixOwnedTree({
        ...handle,
        onForceConfirmed: () => settleOnce({ code: null, signal: "SIGKILL" }),
        gracefulTimeoutMs: options.gracefulTimeoutMs ?? DEFAULT_GRACEFUL_TIMEOUT_MS,
        forceTimeoutMs: options.forceTimeoutMs ?? DEFAULT_FORCE_TIMEOUT_MS,
        pid,
      });
      return termination;
    },
  };
}

function ownedWindowsProcess(handle: WindowsOwnedProcessHandle, options: SpawnOwnedProcessOptions): OwnedProcess {
  const pid = requireSafeRootPid(handle.child.pid);
  const exited = observeExit(handle.child);
  let termination: Promise<void> | undefined;
  return {
    child: handle.child,
    pid,
    exited,
    terminate() {
      termination ??= terminateWindowsOwnedTree({
        exited,
        treeExists: () => handle.treeExists(),
        signalTree: (force) => handle.signalTree(force),
        dispose: handle.dispose?.bind(handle),
        gracefulTimeoutMs: options.gracefulTimeoutMs ?? DEFAULT_GRACEFUL_TIMEOUT_MS,
        forceTimeoutMs: options.forceTimeoutMs ?? DEFAULT_FORCE_TIMEOUT_MS,
        pid,
      });
      return termination;
    },
  };
}

export async function terminateUnixOwnedTree(options: UnixOwnedProcessHandle & {
  onForceConfirmed(): void;
  gracefulTimeoutMs: number;
  forceTimeoutMs: number;
  pid: number;
}): Promise<void> {
  let primaryError: unknown;
  try {
    await requestOwnedSignal(options, false, options.forceTimeoutMs);
    await gracePeriod(options.gracefulTimeoutMs);
    await requestOwnedSignal(options, true, options.forceTimeoutMs);
    options.onForceConfirmed();
    await confirmUnixGroupExit(options, Date.now() + options.forceTimeoutMs);
  } catch (error) {
    primaryError = error;
  }

  const reapError = await boundedGuardianReap(options.guardianExited, options.pid, options.forceTimeoutMs);
  try {
    await options.dispose?.();
  } catch (error) {
    if (primaryError === undefined && reapError === undefined) primaryError = error;
  }
  if (primaryError !== undefined) throw primaryError;
  if (reapError !== undefined) throw reapError;
}

async function requestOwnedSignal(
  options: Pick<UnixOwnedProcessHandle, "signalOwnedTree"> & { pid: number },
  force: boolean,
  timeoutMs: number,
): Promise<void> {
  const result = await Promise.race([
    Promise.resolve(options.signalOwnedTree(force)),
    timeout(timeoutMs, `Owned process guardian ${options.pid} did not accept ${force ? "SIGKILL" : "SIGTERM"}`),
  ]);
  if (result === "ownership-lost") {
    throw new Error(`Owned process tree ${options.pid} ownership identity was lost; refusing to signal a possibly reused process group`);
  }
}

const nodeUnixProcessTreeAdapter: UnixProcessTreeAdapter = {
  spawnOwned(command, args, options) {
    const guardian = spawn(process.execPath, ["--input-type=module", "--eval", UNIX_GUARDIAN_SOURCE], {
      ...options,
      detached: true,
      stdio: guardianStdio(options.stdio),
    });
    const rootPid = requireSafeRootPid(guardian.pid);
    return superviseUnixGuardian(guardian, rootPid, command, args, options.cwd);
  },
};

function superviseUnixGuardian(
  guardian: ChildProcess,
  rootPid: number,
  command: string,
  args: readonly string[],
  cwd: string | URL | undefined,
): UnixOwnedProcessHandle {
  let commandSettled = false;
  let finishCommand!: (exit: OwnedProcessExit) => void;
  const commandExited = new Promise<OwnedProcessExit>((resolve) => { finishCommand = resolve; });
  const guardianExited = observeExit(guardian);
  const signalRequests = new Map<number, (result: "signaled" | "ownership-lost") => void>();
  let requestId = 0;

  const settleCommand = (exit: OwnedProcessExit) => {
    if (commandSettled) return;
    commandSettled = true;
    finishCommand(exit);
  };
  const loseOwnership = () => {
    for (const resolve of signalRequests.values()) resolve("ownership-lost");
    signalRequests.clear();
  };
  const onMessage = (message: unknown) => {
    if (!isRecord(message)) return;
    if (message.type === "commandExit") {
      settleCommand({
        code: typeof message.code === "number" ? message.code : null,
        signal: typeof message.signal === "string" ? message.signal as NodeJS.Signals : null,
        ...(typeof message.error === "string" ? { error: new Error(message.error) } : {}),
      });
      return;
    }
    if (message.type === "signalResult" && Number.isSafeInteger(message.id)) {
      const resolve = signalRequests.get(message.id as number);
      if (resolve === undefined) return;
      signalRequests.delete(message.id as number);
      resolve(message.result === "signaled" ? "signaled" : "ownership-lost");
    }
  };
  guardian.on("message", onMessage);
  guardianExited.then((exit) => {
    loseOwnership();
    settleCommand(exit.error === undefined
      ? { code: null, signal: exit.signal, error: new Error("Owned process guardian exited before the command reported completion") }
      : exit);
  });
  void sendGuardianMessage(guardian, {
    type: "start",
    command,
    args: [...args],
    ...(cwd === undefined ? {} : { cwd: String(cwd) }),
  }).catch((error) => settleCommand({ code: null, signal: null, error }));

  return {
    child: guardian,
    commandExited,
    guardianExited,
    signalOwnedTree(force) {
      const id = ++requestId;
      const response = new Promise<"signaled" | "ownership-lost">((resolve) => {
        signalRequests.set(id, resolve);
      });
      return confirmGuardianSignalDispatch(
        sendGuardianMessage(guardian, { type: "signal", id, force }),
        response,
      ).finally(() => { signalRequests.delete(id); });
    },
    ownedGroupExists() {
      return unixGroupExists(rootPid);
    },
    dispose() {
      guardian.off("message", onMessage);
      loseOwnership();
    },
  };
}

export async function confirmGuardianSignalDispatch(
  sendCompleted: Promise<void>,
  response: Promise<"signaled" | "ownership-lost">,
): Promise<"signaled" | "ownership-lost"> {
  try {
    const [, result] = await Promise.all([sendCompleted, response]);
    return result;
  } catch {
    return "ownership-lost";
  }
}

function guardianStdio(stdio: StdioOptions | undefined): StdioOptions {
  if (stdio === undefined || stdio === "inherit") return ["inherit", "inherit", "inherit", "ipc"];
  if (stdio === "ignore") return ["ignore", "ignore", "ignore", "ipc"];
  if (stdio === "pipe") return ["pipe", "pipe", "pipe", "ipc"];
  if (Array.isArray(stdio)) {
    if (stdio.length > 3 || stdio.includes("ipc")) {
      throw new Error("Unix process guardian supports only stdin/stdout/stderr stdio entries");
    }
    return [stdio[0] ?? "pipe", stdio[1] ?? "pipe", stdio[2] ?? "pipe", "ipc"];
  }
  throw new Error("Unix process guardian received unsupported stdio configuration");
}

function sendGuardianMessage(guardian: ChildProcess, message: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!guardian.connected) {
      reject(new Error("Owned process guardian IPC is unavailable"));
      return;
    }
    try {
      guardian.send(message, (error) => error ? reject(error) : resolve());
    } catch (error) {
      reject(error);
    }
  });
}

function unixGroupExists(rootPid: number): boolean {
  requireSafeRootPid(rootPid);
  try {
    process.kill(-rootPid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return false;
    if (code === "EPERM") return true;
    throw error;
  }
}

function requireSafeRootPid(pid: number | undefined): number {
  if (pid === undefined || !Number.isSafeInteger(pid) || pid <= 1 || pid === process.pid) {
    throw new Error("Supervised process did not expose a safe owned root PID");
  }
  return pid;
}

function observeExit(child: ChildProcess): Promise<OwnedProcessExit> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: OwnedProcessExit) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    child.once("exit", (code, signal) => finish({ code, signal }));
    child.once("error", (error) => finish({ code: null, signal: null, error }));
  });
}

export class OwnedProcessTreeExitUnconfirmedError extends Error {
  readonly code = "owned_process_tree_exit_unconfirmed";

  constructor(readonly pid: number) {
    super(`Could not confirm that owned process group ${pid} disappeared after forced termination`);
    this.name = "OwnedProcessTreeExitUnconfirmedError";
  }
}

async function confirmUnixGroupExit(
  options: Pick<UnixOwnedProcessHandle, "ownedGroupExists"> & { pid: number },
  deadline: number,
): Promise<void> {
  const failure = () => new OwnedProcessTreeExitUnconfirmedError(options.pid);
  while (true) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw failure();
    let exists: boolean;
    try {
      exists = await Promise.race([
        Promise.resolve().then(() => options.ownedGroupExists()),
        rejectAtDeadline(remaining, failure),
      ]);
    } catch {
      throw failure();
    }
    if (!exists) return;
    const pause = Math.min(20, deadline - Date.now());
    if (pause <= 0) throw failure();
    await delay(pause);
  }
}

async function boundedGuardianReap(
  guardianExited: Promise<OwnedProcessExit>,
  pid: number,
  timeoutMs: number,
): Promise<unknown | undefined> {
  try {
    await Promise.race([
      guardianExited,
      timeout(timeoutMs, `Owned process guardian ${pid} was not reaped`),
    ]);
    return undefined;
  } catch (error) {
    return error;
  }
}

async function terminateWindowsOwnedTree(options: {
  exited: Promise<OwnedProcessExit>;
  treeExists(): boolean | Promise<boolean>;
  signalTree(force: boolean): void | Promise<void>;
  dispose?: () => void | Promise<void>;
  gracefulTimeoutMs: number;
  forceTimeoutMs: number;
  pid: number;
}): Promise<void> {
  try {
    if (await options.treeExists()) {
      await options.signalTree(false);
      if (!await waitUntil(() => options.treeExists(), false, options.gracefulTimeoutMs)) {
        await options.signalTree(true);
        if (!await waitUntil(() => options.treeExists(), false, options.forceTimeoutMs)) {
          throw new Error(`Owned process tree ${options.pid} did not exit after forced termination`);
        }
      }
    }
    await Promise.race([
      options.exited,
      timeout(options.forceTimeoutMs, `Owned process leader ${options.pid} was not reaped`),
    ]);
  } finally {
    await options.dispose?.();
  }
}

async function waitUntil(
  read: () => boolean | Promise<boolean>,
  expected: boolean,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await read() === expected) return true;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return await read() === expected;
}

function timeout(timeoutMs: number, message: string): Promise<never> {
  return new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    timer.unref?.();
  });
}

function rejectAtDeadline(timeoutMs: number, createError: () => Error): Promise<never> {
  return new Promise((_, reject) => {
    const timer = setTimeout(() => reject(createError()), timeoutMs);
    timer.unref?.();
  });
}

function delay(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    timer.unref?.();
  });
}

function gracePeriod(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    timer.unref?.();
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error("Owned command exit observation failed");
}

const UNIX_GUARDIAN_SOURCE = String.raw`
import { spawn } from "node:child_process";

let started = false;
let commandSettled = false;

process.on("SIGTERM", () => {});
process.on("SIGINT", () => {});

function send(message, callback) {
  if (typeof process.send !== "function" || !process.connected) {
    callback?.(new Error("guardian IPC disconnected"));
    return;
  }
  process.send(message, callback);
}

function reportCommandExit(exit) {
  if (commandSettled) return;
  commandSettled = true;
  send({ type: "commandExit", ...exit });
}

function signalOwnedGroup(signal) {
  if (!Number.isSafeInteger(process.pid) || process.pid <= 1) {
    throw new Error("guardian has unsafe process-group identity");
  }
  process.kill(-process.pid, signal);
}

process.on("message", (message) => {
  if (message?.type === "start" && !started) {
    started = true;
    let child;
    try {
      child = spawn(message.command, message.args, {
        cwd: message.cwd,
        env: process.env,
        stdio: "inherit",
        shell: false,
        windowsHide: true,
      });
    } catch (error) {
      reportCommandExit({ code: null, signal: null, error: error instanceof Error ? error.message : "command spawn failed" });
      return;
    }
    child.once("error", (error) => reportCommandExit({ code: null, signal: null, error: error.message }));
    child.once("exit", (code, signal) => reportCommandExit({ code, signal }));
    return;
  }
  if (message?.type !== "signal" || !Number.isSafeInteger(message.id)) return;
  const signal = message.force ? "SIGKILL" : "SIGTERM";
  if (message.force) {
    send({ type: "signalResult", id: message.id, result: "signaled" }, () => {
      setImmediate(() => signalOwnedGroup(signal));
    });
    return;
  }
  try {
    signalOwnedGroup(signal);
    send({ type: "signalResult", id: message.id, result: "signaled" });
  } catch {
    send({ type: "signalResult", id: message.id, result: "ownership-lost" });
  }
});

process.on("disconnect", () => {
  try { signalOwnedGroup("SIGKILL"); } catch { process.exit(1); }
});

setInterval(() => {}, 2 ** 30);
`;

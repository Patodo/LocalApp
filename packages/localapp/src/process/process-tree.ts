import { spawn, type ChildProcess, type SpawnOptions, type StdioOptions } from "node:child_process";

export interface OwnedProcessExit {
  code: number | null;
  signal: NodeJS.Signals | null;
  error?: Error;
}

export interface OwnedProcess {
  readonly child: ChildProcess;
  readonly pid: number;
  readonly exited: Promise<OwnedProcessExit>;
  terminate(): Promise<void>;
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
  windowsAdapter?: WindowsProcessTreeAdapter;
  gracefulTimeoutMs?: number;
  forceTimeoutMs?: number;
}

const DEFAULT_GRACEFUL_TIMEOUT_MS = 3_000;
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
  let child: ChildProcess;
  let treeExists: () => boolean | Promise<boolean>;
  let signalTree: (force: boolean) => void | Promise<void>;
  let dispose: (() => void | Promise<void>) | undefined;

  if (platform === "win32") {
    if (options.windowsAdapter === undefined) {
      throw new Error("Windows process-tree adapter is unavailable; refusing to spawn without atomic Job Object ownership");
    }
    const handle = options.windowsAdapter.spawnOwned(command, args, spawnOptions);
    child = handle.child;
    treeExists = () => handle.treeExists();
    signalTree = (force) => handle.signalTree(force);
    dispose = handle.dispose?.bind(handle);
  } else {
    child = spawn(command, args, { ...spawnOptions, detached: true });
    const rootPid = requireSafeRootPid(child.pid);
    let retired = false;
    treeExists = () => {
      if (retired) return false;
      try {
        process.kill(-rootPid, 0);
        return true;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ESRCH") {
          retired = true;
          return false;
        }
        if (code === "EPERM") return true;
        throw error;
      }
    };
    signalTree = (force) => {
      if (retired) return;
      requireSafeRootPid(rootPid);
      try {
        process.kill(-rootPid, force ? "SIGKILL" : "SIGTERM");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ESRCH") {
          retired = true;
          return;
        }
        throw error;
      }
    };
  }

  const pid = requireSafeRootPid(child.pid);
  const exited = observeExit(child);
  let termination: Promise<void> | undefined;
  return {
    child,
    pid,
    exited,
    terminate() {
      termination ??= terminateOwnedTree({
        exited,
        treeExists,
        signalTree,
        dispose,
        gracefulTimeoutMs: options.gracefulTimeoutMs ?? DEFAULT_GRACEFUL_TIMEOUT_MS,
        forceTimeoutMs: options.forceTimeoutMs ?? DEFAULT_FORCE_TIMEOUT_MS,
        pid,
      });
      return termination;
    },
  };
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

async function terminateOwnedTree(options: {
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

import { EventEmitter, once } from "node:events";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { TaskStore, type TaskKind, type TaskRecord, type TaskStatus } from "./task-store.js";
import type { WorkspaceStore } from "./workspace-store.js";

export type { TaskRecord } from "./task-store.js";

export interface StartTaskInput {
  workspaceId: string;
  kind: "build" | "test" | "git" | "agent";
  executable: string;
  args: string[];
  timeoutMs: number;
  requestedBy: string;
}

export interface TaskLogChunk {
  cursor: number;
  nextCursor: number;
  content: string;
  eof: boolean;
}

export interface TaskEvent {
  taskId: string;
  status: TaskStatus;
  task: TaskRecord;
}

export interface TaskRunnerOptions {
  workspaceStore: WorkspaceStore;
  taskStore: TaskStore;
  taskDir: string;
  allowedExecutables?: Record<string, string>;
}

interface ActiveTask {
  child: ChildProcess;
  desiredStatus: Exclude<TaskStatus, "running" | "succeeded" | "failed"> | null;
  timer: NodeJS.Timeout;
  closed: Promise<void>;
}

const MAX_TIMEOUT_MS = 60 * 60_000;
const MAX_LOG_CHUNK_BYTES = 64 * 1024;
const DEFAULT_EXECUTABLES = ["node", "npm", "pnpm", "git", "localapp", "codex", "opencode"] as const;

export class TaskRunner {
  private readonly active = new Map<string, ActiveTask>();
  private readonly emitters = new Map<string, EventEmitter>();
  private readonly allowedExecutables = new Map<string, string>();

  constructor(private readonly options: TaskRunnerOptions) {
    fs.mkdirSync(options.taskDir, { recursive: true });
    for (const executable of DEFAULT_EXECUTABLES) {
      const resolved = executable === "node" ? process.execPath : findExecutable(executable);
      if (resolved) this.allowedExecutables.set(executable, resolved);
    }
    for (const [name, executablePath] of Object.entries(options.allowedExecutables ?? {})) {
      this.setAllowedExecutable(name, executablePath);
    }
  }

  setAllowedExecutable(name: string, executablePath: string): void {
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(name)) throw new Error("Invalid executable allowlist name");
    const resolved = fs.realpathSync(executablePath);
    if (!fs.statSync(resolved).isFile()) throw new Error("Allowlisted executable is not a file");
    this.allowedExecutables.set(name, resolved);
  }

  resolveAllowedExecutable(name: string): string | null {
    return this.allowedExecutables.get(name) ?? null;
  }

  async start(input: StartTaskInput): Promise<TaskRecord> {
    validateStartInput(input);
    const workspacePath = this.options.workspaceStore.requireOwnedPath(input.workspaceId, input.requestedBy);
    const executablePath = this.allowedExecutables.get(input.executable);
    if (!executablePath) throw new Error(`Executable is not an allowlisted executable: ${input.executable}`);

    const id = randomUUID();
    const outputPath = path.join(this.options.taskDir, `${id}.log`);
    fs.writeFileSync(outputPath, "", { mode: 0o600 });
    let record: TaskRecord;
    try {
      record = this.options.taskStore.create({ ...input, id, outputPath, status: "running" });
    } catch (error) {
      fs.rmSync(outputPath, { force: true });
      throw error;
    }

    const output = fs.openSync(outputPath, "a");
    let child: ChildProcess;
    try {
      child = spawn(executablePath, input.args, {
        cwd: workspacePath,
        env: boundedEnvironment(),
        shell: false,
        detached: process.platform !== "win32",
        stdio: ["ignore", output, output],
        windowsHide: true,
      });
    } catch (error) {
      fs.closeSync(output);
      return Promise.reject(this.finishSpawnFailure(record.id, error));
    }
    fs.closeSync(output);

    const emitter = new EventEmitter();
    this.emitters.set(record.id, emitter);
    let closeActive!: () => void;
    const closed = new Promise<void>((resolve) => { closeActive = resolve; });
    const timer = setTimeout(() => void this.terminate(record.id, "timed_out"), input.timeoutMs);
    timer.unref();
    const active: ActiveTask = { child, desiredStatus: null, timer, closed };
    this.active.set(record.id, active);

    child.once("close", (code, signal) => {
      clearTimeout(timer);
      this.active.delete(record.id);
      const current = this.options.taskStore.get(record.id);
      if (current?.status === "running") {
        const desired = active.desiredStatus;
        const status = desired ?? (code === 0 ? "succeeded" : "failed");
        const finished = this.options.taskStore.finish(record.id, status, {
          exitCode: code,
          error: status === "failed" ? `Process exited with ${code ?? signal ?? "unknown status"}` : null,
        });
        this.emit(record.id, finished);
      }
      closeActive();
      setImmediate(() => this.emitters.delete(record.id));
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      this.active.delete(record.id);
      const current = this.options.taskStore.get(record.id);
      if (current?.status === "running") {
        const failed = this.options.taskStore.finish(record.id, "failed", { error: boundedError(error) });
        this.emit(record.id, failed);
      }
      closeActive();
      setImmediate(() => this.emitters.delete(record.id));
    });

    try {
      await once(child, "spawn");
    } catch (error) {
      const current = this.options.taskStore.get(record.id);
      if (current?.status === "running") this.finishSpawnFailure(record.id, error);
      throw error;
    }

    if (!child.pid) {
      const error = new Error("Spawned task has no process ID");
      this.finishSpawnFailure(record.id, error);
      throw error;
    }
    const started = this.options.taskStore.setPid(record.id, child.pid);

    this.emit(record.id, started);
    return started;
  }

  async cancel(id: string): Promise<TaskRecord> {
    const record = this.options.taskStore.get(id);
    if (!record) throw new Error("TASK_NOT_FOUND");
    if (record.status !== "running") return record;
    await this.terminate(id, "cancelled");
    return this.options.taskStore.get(id)!;
  }

  logs(id: string, cursor: number): TaskLogChunk {
    const outputPath = this.options.taskStore.outputPath(id);
    if (!outputPath) throw new Error("TASK_NOT_FOUND");
    const size = fs.statSync(outputPath, { throwIfNoEntry: false })?.size ?? 0;
    const safeCursor = Number.isSafeInteger(cursor) && cursor >= 0 ? Math.min(cursor, size) : 0;
    const length = Math.min(MAX_LOG_CHUNK_BYTES, size - safeCursor);
    const buffer = Buffer.alloc(length);
    if (length > 0) {
      const descriptor = fs.openSync(outputPath, "r");
      try {
        fs.readSync(descriptor, buffer, 0, length, safeCursor);
      } finally {
        fs.closeSync(descriptor);
      }
    }
    return { cursor: safeCursor, nextCursor: safeCursor + length, content: buffer.toString("utf8"), eof: safeCursor + length >= size };
  }

  events(id: string): EventEmitter {
    let emitter = this.emitters.get(id);
    if (!emitter) {
      emitter = new EventEmitter();
      this.emitters.set(id, emitter);
    }
    return emitter;
  }

  async shutdown(): Promise<void> {
    await Promise.all([...this.active.keys()].map((id) => this.terminate(id, "interrupted")));
  }

  private async terminate(id: string, status: "cancelled" | "timed_out" | "interrupted"): Promise<void> {
    const active = this.active.get(id);
    if (!active) {
      const record = this.options.taskStore.get(id);
      if (record?.status === "running") this.emit(id, this.options.taskStore.finish(id, status));
      return;
    }
    if (!active.desiredStatus) active.desiredStatus = status;
    signalProcessTree(active.child, "SIGTERM");
    const closedAfterTerm = await waitBounded(active.closed, 1_000);
    if (!closedAfterTerm) {
      signalProcessTree(active.child, "SIGKILL");
      await waitBounded(active.closed, 1_000);
    }
    const current = this.options.taskStore.get(id);
    if (current?.status === "running") this.emit(id, this.options.taskStore.finish(id, status));
  }

  private finishSpawnFailure(id: string, error: unknown): Error {
    const failed = this.options.taskStore.finish(id, "failed", { error: boundedError(error) });
    this.emit(id, failed);
    return error instanceof Error ? error : new Error(String(error));
  }

  private emit(id: string, task: TaskRecord): void {
    this.emitters.get(id)?.emit("event", { taskId: id, status: task.status, task } satisfies TaskEvent);
  }
}

function validateStartInput(input: StartTaskInput): void {
  if (!(["build", "test", "git", "agent"] satisfies TaskKind[]).includes(input.kind)) throw new Error("Invalid task kind");
  if (!input.workspaceId || !input.requestedBy) throw new Error("Workspace and requester are required");
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(input.executable)) throw new Error("Executable is not an allowlisted executable");
  if (!Array.isArray(input.args) || !input.args.every((argument) => typeof argument === "string" && Buffer.byteLength(argument) <= 64 * 1024)) {
    throw new Error("Invalid task arguments");
  }
  if (!Number.isSafeInteger(input.timeoutMs) || input.timeoutMs < 1 || input.timeoutMs > MAX_TIMEOUT_MS) throw new Error("Invalid task timeout");
}

function boundedEnvironment(): NodeJS.ProcessEnv {
  const exact = [
    "PATH", "HOME", "USER", "LOGNAME", "LANG", "LC_ALL", "LC_CTYPE", "TERM", "TMPDIR", "TMP", "TEMP",
    "SSH_AUTH_SOCK", "GIT_SSH", "GIT_SSH_COMMAND", "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY",
    "http_proxy", "https_proxy", "no_proxy",
  ];
  const environment: NodeJS.ProcessEnv = {};
  for (const key of exact) if (process.env[key] !== undefined) environment[key] = process.env[key];
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && ["LOCALAPP_", "NODE_", "npm_", "OPENCODE_"].some((prefix) => key.startsWith(prefix))) environment[key] = value;
  }
  return environment;
}

function findExecutable(name: string): string | null {
  const pathValue = process.env.PATH ?? "";
  const extensions = process.platform === "win32"
    ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";")
    : [""];
  for (const directory of pathValue.split(path.delimiter)) {
    if (!directory) continue;
    for (const extension of extensions) {
      const candidate = path.join(directory, `${name}${extension}`);
      try {
        if (fs.statSync(candidate).isFile()) return fs.realpathSync(candidate);
      } catch {
        // Continue searching PATH.
      }
    }
  }
  return null;
}

function signalProcessTree(child: ChildProcess, signal: NodeJS.Signals): void {
  if (!child.pid) return;
  try {
    if (process.platform === "win32") child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

async function waitBounded(promise: Promise<void>, milliseconds: number): Promise<boolean> {
  return Promise.race([
    promise.then(() => true),
    new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), milliseconds);
      timer.unref();
    }),
  ]);
}

function boundedError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return Buffer.from(message, "utf8").subarray(0, 4_096).toString("utf8");
}

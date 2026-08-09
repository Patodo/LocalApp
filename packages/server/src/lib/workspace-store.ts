import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import yauzl, { type Entry, type ZipFile } from "yauzl";
import { flushMetaDb, getDb } from "./meta-sqlite.js";
import { resolveWorkspacePath } from "./workspace-path.js";
import type { TaskRecord, TaskRunner } from "./task-runner.js";

export interface WorkspaceRecord {
  id: string;
  ownerId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceArchiveLimits {
  maxCompressedBytes: number;
  maxExpandedBytes: number;
  maxFileEntries: number;
}

export interface WorkspaceStoreOptions {
  workspaceDir: string;
  archiveLimits?: Partial<WorkspaceArchiveLimits>;
}

const DEFAULT_ARCHIVE_LIMITS: WorkspaceArchiveLimits = {
  maxCompressedBytes: 100 * 1024 * 1024,
  maxExpandedBytes: 500 * 1024 * 1024,
  maxFileEntries: 10_000,
};

export class WorkspaceStore {
  readonly workspaceDir: string;
  readonly archiveLimits: WorkspaceArchiveLimits;
  private taskRunner: TaskRunner | null = null;
  private readonly cloneProcesses = new Set<ChildProcess>();

  constructor(options: WorkspaceStoreOptions) {
    const workspaceDir = path.resolve(options.workspaceDir);
    this.archiveLimits = { ...DEFAULT_ARCHIVE_LIMITS, ...options.archiveLimits };
    fs.mkdirSync(workspaceDir, { recursive: true });
    this.workspaceDir = fs.realpathSync(workspaceDir);
  }

  setTaskRunner(taskRunner: TaskRunner): void {
    this.taskRunner = taskRunner;
  }

  async create(input: { name: string; ownerId: string }): Promise<WorkspaceRecord> {
    const name = requireName(input.name);
    const id = randomUUID();
    const temporary = this.temporaryPath(id);
    const destination = this.pathFor(id);
    fs.mkdirSync(temporary, { recursive: true });
    try {
      fs.renameSync(temporary, destination);
      return this.insert({ id, ownerId: input.ownerId, name });
    } catch (error) {
      fs.rmSync(temporary, { recursive: true, force: true });
      fs.rmSync(destination, { recursive: true, force: true });
      throw error;
    }
  }

  async clone(input: { name: string; ownerId: string; repositoryUrl: string }): Promise<WorkspaceRecord> {
    const name = requireName(input.name);
    const repositoryUrl = input.repositoryUrl.trim();
    if (!repositoryUrl) throw new Error("Repository URL is required");
    if (path.isAbsolute(repositoryUrl) || /^file:/i.test(repositoryUrl)) {
      throw new Error("Repository URL must not reference an absolute local path");
    }
    if (repositoryUrl.startsWith("-")) throw new Error("Repository URL is invalid");
    if (!isRemoteRepositoryUrl(repositoryUrl)) throw new Error("Repository URL must not reference a local path");

    const id = randomUUID();
    const temporary = this.temporaryPath(id);
    const destination = this.pathFor(id);
    try {
      await this.runGitClone(repositoryUrl, temporary);
      fs.renameSync(temporary, destination);
      return this.insert({ id, ownerId: input.ownerId, name });
    } catch (error) {
      fs.rmSync(temporary, { recursive: true, force: true });
      fs.rmSync(destination, { recursive: true, force: true });
      throw error;
    }
  }

  async importArchive(input: { name: string; ownerId: string; archivePath: string }): Promise<WorkspaceRecord> {
    const name = requireName(input.name);
    const archivePath = path.resolve(input.archivePath);
    const archiveSize = fs.statSync(archivePath).size;
    if (archiveSize > this.archiveLimits.maxCompressedBytes) throw archiveLimitError("compressed size");

    const id = randomUUID();
    const temporary = this.temporaryPath(id);
    const destination = this.pathFor(id);
    fs.mkdirSync(temporary, { recursive: true });
    try {
      await extractArchive(archivePath, temporary, this.archiveLimits);
      fs.renameSync(temporary, destination);
      return this.insert({ id, ownerId: input.ownerId, name });
    } catch (error) {
      fs.rmSync(temporary, { recursive: true, force: true });
      fs.rmSync(destination, { recursive: true, force: true });
      throw error;
    }
  }

  list(ownerId: string): WorkspaceRecord[] {
    const statement = getDb().prepare("SELECT * FROM workspaces WHERE owner_id = ? ORDER BY created_at DESC, id DESC");
    statement.bind([ownerId]);
    const records: WorkspaceRecord[] = [];
    while (statement.step()) records.push(workspaceFromRow(statement.getAsObject()));
    statement.free();
    return records;
  }

  get(id: string): WorkspaceRecord | null {
    const statement = getDb().prepare("SELECT * FROM workspaces WHERE id = ?");
    statement.bind([id]);
    const record = statement.step() ? workspaceFromRow(statement.getAsObject()) : null;
    statement.free();
    return record;
  }

  getOwned(id: string, ownerId: string): WorkspaceRecord | null {
    const record = this.get(id);
    return record?.ownerId === ownerId ? record : null;
  }

  pathFor(id: string): string {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Invalid workspace ID");
    return path.join(this.workspaceDir, id);
  }

  requireOwnedPath(id: string, ownerId: string): string {
    if (!this.getOwned(id, ownerId)) throw new Error("WORKSPACE_NOT_FOUND");
    const workspacePath = this.pathFor(id);
    const workspaceStat = fs.lstatSync(workspacePath, { throwIfNoEntry: false });
    if (!workspaceStat?.isDirectory() || workspaceStat.isSymbolicLink()) throw new Error("WORKSPACE_NOT_FOUND");
    if (fs.realpathSync(workspacePath) !== workspacePath) throw new Error("WORKSPACE_NOT_FOUND");
    return workspacePath;
  }

  async readFile(id: string, ownerId: string, relativePath: string): Promise<string> {
    const filePath = resolveWorkspacePath(this.requireOwnedPath(id, ownerId), relativePath);
    if (!fs.statSync(filePath, { throwIfNoEntry: false })?.isFile()) throw new Error("WORKSPACE_FILE_NOT_FOUND");
    return fs.readFileSync(filePath, "utf8");
  }

  async writeFile(id: string, ownerId: string, relativePath: string, content: string | Buffer): Promise<void> {
    const filePath = resolveWorkspacePath(this.requireOwnedPath(id, ownerId), relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, { mode: 0o600 });
    const now = new Date().toISOString();
    getDb().run("UPDATE workspaces SET updated_at = ? WHERE id = ? AND owner_id = ?", [now, id, ownerId]);
    flushMetaDb();
  }

  async remove(id: string, ownerId: string): Promise<boolean> {
    const record = this.getOwned(id, ownerId);
    if (!record) return false;
    fs.rmSync(this.pathFor(id), { recursive: true, force: true });
    getDb().run("DELETE FROM workspaces WHERE id = ? AND owner_id = ?", [id, ownerId]);
    flushMetaDb();
    return true;
  }

  async build(id: string, requestedBy: string, timeoutMs = 15 * 60_000): Promise<TaskRecord> {
    return this.requireTaskRunner().start({
      workspaceId: id,
      kind: "build",
      executable: "npm",
      args: ["run", "build"],
      timeoutMs,
      requestedBy,
    });
  }

  async install(id: string, requestedBy: string, timeoutMs = 15 * 60_000): Promise<TaskRecord> {
    return this.requireTaskRunner().start({
      workspaceId: id,
      kind: "build",
      executable: "localapp",
      args: ["upload"],
      timeoutMs,
      requestedBy,
    });
  }

  async shutdown(): Promise<void> {
    const children = [...this.cloneProcesses];
    for (const child of children) signalProcessTree(child, "SIGTERM");
    await Promise.all(children.map((child) => waitForChildClose(child, 1_000)));
    const remaining = [...this.cloneProcesses];
    for (const child of remaining) signalProcessTree(child, "SIGKILL");
    await Promise.all(remaining.map((child) => waitForChildClose(child, 1_000)));
  }

  private insert(input: { id: string; ownerId: string; name: string }): WorkspaceRecord {
    const now = new Date().toISOString();
    getDb().run(
      "INSERT INTO workspaces (id, owner_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      [input.id, input.ownerId, input.name, now, now],
    );
    flushMetaDb();
    return { id: input.id, ownerId: input.ownerId, name: input.name, createdAt: now, updatedAt: now };
  }

  private temporaryPath(id: string): string {
    return path.join(this.workspaceDir, `.tmp-${id}-${randomUUID()}`);
  }

  private requireTaskRunner(): TaskRunner {
    if (!this.taskRunner) throw new Error("Task runner is not configured");
    return this.taskRunner;
  }

  private runGitClone(repositoryUrl: string, destination: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn("git", ["clone", "--", repositoryUrl, destination], {
        shell: false,
        detached: process.platform !== "win32",
        stdio: ["ignore", "ignore", "pipe"],
        env: boundedEnvironment(),
        windowsHide: true,
      });
      this.cloneProcesses.add(child);
      let stderr = "";
      let settled = false;
      child.stderr!.on("data", (chunk) => {
        if (stderr.length < 64 * 1024) stderr += String(chunk);
      });
      child.once("error", (error) => {
        this.cloneProcesses.delete(child);
        if (!settled) {
          settled = true;
          reject(error);
        }
      });
      child.once("close", (code, signal) => {
        this.cloneProcesses.delete(child);
        if (settled) return;
        settled = true;
        if (code === 0) resolve();
        else reject(new Error(`Git clone failed (${code ?? signal ?? "signal"}): ${stderr.trim()}`));
      });
    });
  }
}

function workspaceFromRow(row: Record<string, unknown>): WorkspaceRecord {
  return {
    id: String(row.id),
    ownerId: String(row.owner_id),
    name: String(row.name),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function requireName(value: string): string {
  const name = value?.trim();
  if (!name) throw new Error("Workspace name is required");
  if (Buffer.byteLength(name, "utf8") > 200) throw new Error("Workspace name is too long");
  return name;
}

function isRemoteRepositoryUrl(value: string): boolean {
  if (/^[^@/\s]+@[^:/\s]+:.+$/.test(value)) return true;
  try {
    return ["http:", "https:", "ssh:", "git:", "ftp:", "ftps:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function archiveLimitError(limit: string): Error {
  return new Error(`Workspace archive limit exceeded: ${limit}`);
}

function openArchive(archivePath: string): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(archivePath, { lazyEntries: true, decodeStrings: true, validateEntrySizes: true }, (error, zipFile) => {
      if (error || !zipFile) {
        const message = error instanceof Error ? error.message : String(error ?? "Unable to open workspace archive");
        reject(/invalid relative path/i.test(message) ? new Error(`Path crosses workspace boundary: ${message}`) : (error ?? new Error(message)));
      }
      else resolve(zipFile);
    });
  });
}

function openEntry(zipFile: ZipFile, entry: Entry): Promise<NodeJS.ReadableStream> {
  return new Promise((resolve, reject) => {
    zipFile.openReadStream(entry, (error, stream) => {
      if (error || !stream) reject(error ?? new Error("Unable to read workspace archive entry"));
      else resolve(stream);
    });
  });
}

async function extractArchive(archivePath: string, destination: string, limits: WorkspaceArchiveLimits): Promise<void> {
  const zipFile = await openArchive(archivePath);
  let entries = 0;
  let expandedBytes = 0;
  const seen = new Set<string>();

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      zipFile.close();
      const message = error instanceof Error ? error.message : String(error);
      reject(/invalid relative path/i.test(message) ? new Error(`Path crosses workspace boundary: ${message}`) : error);
    };
    zipFile.once("error", fail);
    zipFile.once("end", () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    });
    zipFile.on("entry", (entry: Entry) => {
      void (async () => {
        entries += 1;
        if (entries > limits.maxFileEntries) throw archiveLimitError("file count");
        const entryName = entry.fileName;
        if (!entryName || entryName.includes("\\") || path.posix.isAbsolute(entryName) || /^[A-Za-z]:/.test(entryName)) {
          throw new Error(`Path crosses workspace boundary: ${entryName}`);
        }
        const normalized = path.posix.normalize(entryName);
        if (normalized === ".." || normalized.startsWith("../") || seen.has(normalized)) {
          throw new Error(`Path crosses workspace boundary: ${entryName}`);
        }
        seen.add(normalized);
        expandedBytes += entry.uncompressedSize;
        if (expandedBytes > limits.maxExpandedBytes) throw archiveLimitError("expanded size");

        const fileType = (entry.externalFileAttributes >>> 16) & 0o170000;
        if (fileType === 0o120000) throw new Error(`Path crosses workspace boundary: ${entryName}`);
        const outputPath = resolveWorkspacePath(destination, normalized.replace(/\/$/, ""));
        if (entryName.endsWith("/")) {
          fs.mkdirSync(outputPath, { recursive: true });
        } else {
          fs.mkdirSync(path.dirname(outputPath), { recursive: true });
          let actualBytes = 0;
          const counter = new Transform({
            transform(chunk: Buffer, _encoding, callback) {
              actualBytes += chunk.length;
              if (expandedBytes - entry.uncompressedSize + actualBytes > limits.maxExpandedBytes) {
                callback(archiveLimitError("expanded size"));
              } else {
                callback(null, chunk);
              }
            },
          });
          await pipeline(await openEntry(zipFile, entry), counter, fs.createWriteStream(outputPath, { mode: 0o600 }));
        }
        zipFile.readEntry();
      })().catch(fail);
    });
    zipFile.readEntry();
  });
}

function boundedEnvironment(): NodeJS.ProcessEnv {
  const allowed = ["PATH", "HOME", "USER", "LOGNAME", "LANG", "LC_ALL", "TMPDIR", "TMP", "TEMP", "SSH_AUTH_SOCK", "GIT_SSH", "GIT_SSH_COMMAND"];
  return Object.fromEntries(allowed.flatMap((key) => process.env[key] === undefined ? [] : [[key, process.env[key]]]));
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

function waitForChildClose(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      child.off("close", finish);
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    timer.unref();
    child.once("close", finish);
  });
}

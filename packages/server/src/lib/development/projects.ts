import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { getDb, flushMetaDb } from "../meta-sqlite.js";
import { resolveWorkspacePath } from "../workspace-path.js";
import { validateName } from "../validate-name.js";

export class DevelopmentError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}
export interface DevelopmentProject {
  id: string;
  ownerId: string;
  name: string;
  createdAt: string;
}
export interface SourceVersion {
  id: string;
  projectId: string;
  message: string;
  createdAt: string;
  digest: string;
}
const excluded = new Set([
  "node_modules",
  ".git",
  "dist",
  ".npm",
  ".pnpm",
  ".cache",
  ".next",
  "coverage",
  ".tmp",
  ".localapp-public-skills",
]);
const MAX_FILE = 2 * 1024 * 1024,
  MAX_SOURCE = 32 * 1024 * 1024,
  MAX_FILES = 5000;
export const contentHash = (content: string | Buffer) =>
  createHash("sha256").update(content).digest("hex");
function allowed(relative: string) {
  const parts = relative.split("/");
  return (
    relative.length > 0 &&
    !relative.includes("\\") &&
    !parts.some(
      (p) =>
        !p ||
        p === "." ||
        p === ".." ||
        excluded.has(p) ||
        p === ".env" ||
        p.startsWith(".env.") ||
        p === ".npmrc" ||
        p.endsWith(".pem") ||
        p.endsWith(".key"),
    ) &&
    !relative.startsWith(".localapp/")
  );
}
function rows<T>(sql: string, args: string[] = []): T[] {
  const stmt = getDb().prepare(sql);
  try {
    stmt.bind(args);
    const result: T[] = [];
    while (stmt.step()) result.push(stmt.getAsObject() as unknown as T);
    return result;
  } finally {
    stmt.free();
  }
}
export class ProjectStore {
  readonly directory: string;
  private readonly locks = new Map<string, symbol>();
  constructor(dataDir: string) {
    this.directory = path.join(dataDir, "development", "projects");
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    getDb()
      .run(`CREATE TABLE IF NOT EXISTS development_projects(id TEXT PRIMARY KEY, ownerId TEXT NOT NULL, name TEXT NOT NULL, createdAt TEXT NOT NULL, UNIQUE(ownerId,name));
CREATE TABLE IF NOT EXISTS development_versions(id TEXT PRIMARY KEY, projectId TEXT NOT NULL, message TEXT NOT NULL, createdAt TEXT NOT NULL, digest TEXT NOT NULL, files TEXT NOT NULL);`);
    flushMetaDb();
  }
  list(ownerId: string) {
    return rows<DevelopmentProject>(
      "SELECT * FROM development_projects WHERE ownerId=? ORDER BY createdAt DESC",
      [ownerId],
    );
  }
  get(id: string, ownerId: string) {
    const p = rows<DevelopmentProject>(
      "SELECT * FROM development_projects WHERE id=? AND ownerId=?",
      [id, ownerId],
    )[0];
    if (!p) throw new DevelopmentError("Project not found", 404);
    return p;
  }
  workspace(id: string, ownerId: string) {
    this.get(id, ownerId);
    return path.join(this.directory, id, "workspace");
  }
  create(ownerId: string, name: string, files: Record<string, string>) {
    const error = validateName(name);
    if (error) throw new DevelopmentError(error);
    if (this.list(ownerId).some((p) => p.name === name))
      throw new DevelopmentError("项目名称已存在", 409);
    const p: DevelopmentProject = {
      id: randomUUID(),
      ownerId,
      name,
      createdAt: new Date().toISOString(),
    };
    const root = path.join(this.directory, p.id, "workspace");
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    try {
      for (const [file, content] of Object.entries(files)) {
        if (!allowed(file)) continue;
        this.save(root, file, content);
      }
      getDb().run("INSERT INTO development_projects VALUES(?,?,?,?)", [
        p.id,
        ownerId,
        name,
        p.createdAt,
      ]);
      this.snapshot(p.id, ownerId, "创建项目");
      flushMetaDb();
      return p;
    } catch (e) {
      getDb().run("DELETE FROM development_projects WHERE id=?", [p.id]);
      fs.rmSync(path.dirname(root), { recursive: true, force: true });
      flushMetaDb();
      throw e;
    }
  }
  private file(id: string, user: string, relative: string) {
    if (!allowed(relative)) throw new DevelopmentError("不允许访问此文件");
    return resolveWorkspacePath(this.workspace(id, user), relative);
  }
  read(id: string, user: string, relative: string) {
    const file = this.file(id, user, relative);
    if (!fs.existsSync(file)) throw new DevelopmentError("文件不存在", 404);
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > MAX_FILE)
      throw new DevelopmentError("文件过大或不是普通文件");
    const content = fs.readFileSync(file, "utf8");
    if (content.includes("\0"))
      throw new DevelopmentError("二进制文件不支持文本编辑");
    return { path: relative, content, hash: contentHash(content) };
  }
  write(
    id: string,
    user: string,
    relative: string,
    content: string,
    expectedHash: string | null,
  ) {
    this.assertIdle(id, user);
    const file = this.file(id, user, relative);
    const current = fs.existsSync(file)
      ? this.read(id, user, relative).hash
      : null;
    if (current !== expectedHash)
      throw new DevelopmentError("文件已改变，请重新读取后保存，避免冲突", 409);
    this.save(this.workspace(id, user), relative, content);
  }
  private save(root: string, relative: string, content: string) {
    if (
      typeof content !== "string" ||
      content.includes("\0") ||
      Buffer.byteLength(content) > MAX_FILE
    )
      throw new DevelopmentError("文件不是文本或超过大小限制");
    const file = resolveWorkspacePath(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = path.join(path.dirname(file), `.save-${randomUUID()}`);
    try {
      fs.writeFileSync(temp, content, { flag: "wx", mode: 0o600 });
      fs.renameSync(temp, file);
    } finally {
      fs.rmSync(temp, { force: true });
    }
  }
  files(id: string, user: string) {
    return Object.keys(this.capture(this.workspace(id, user)));
  }
  private capture(root: string) {
    const files: Record<string, string> = {};
    let bytes = 0,
      count = 0;
    const walk = (dir: string) => {
      for (const entry of fs
        .readdirSync(dir, { withFileTypes: true })
        .sort((a, b) => a.name.localeCompare(b.name))) {
        const abs = path.join(dir, entry.name),
          rel = path.relative(root, abs).split(path.sep).join("/");
        if (!allowed(rel)) continue;
        if (entry.isSymbolicLink())
          throw new DevelopmentError("源码不能包含符号链接");
        if (entry.isDirectory()) walk(abs);
        else if (entry.isFile()) {
          const stat = fs.statSync(abs);
          bytes += stat.size;
          if (++count > MAX_FILES || bytes > MAX_SOURCE || stat.size > MAX_FILE)
            throw new DevelopmentError("项目源码超过大小限制");
          const content = fs.readFileSync(abs, "utf8");
          if (content.includes("\0"))
            throw new DevelopmentError("当前模板源码版本仅支持文本文件");
          files[rel] = content;
        }
      }
    };
    walk(root);
    return files;
  }
  versions(id: string, user: string) {
    this.get(id, user);
    return rows<SourceVersion>(
      "SELECT id,projectId,message,createdAt,digest FROM development_versions WHERE projectId=? ORDER BY rowid DESC",
      [id],
    );
  }
  snapshot(id: string, user: string, message: string) {
    this.get(id, user);
    const files = this.capture(this.workspace(id, user)),
      encoded = JSON.stringify(files);
    const v: SourceVersion = {
      id: randomUUID(),
      projectId: id,
      message,
      createdAt: new Date().toISOString(),
      digest: contentHash(encoded),
    };
    const previous = this.versions(id, user)[0];
    if (previous?.digest === v.digest) return previous;
    getDb().run("INSERT INTO development_versions VALUES(?,?,?,?,?,?)", [
      v.id,
      id,
      message,
      v.createdAt,
      v.digest,
      encoded,
    ]);
    flushMetaDb();
    return v;
  }
  versionFiles(
    id: string,
    user: string,
    version: string,
  ): Record<string, string> {
    this.get(id, user);
    const v = rows<{ files: string }>(
      "SELECT files FROM development_versions WHERE projectId=? AND id=?",
      [id, version],
    )[0];
    if (!v) throw new DevelopmentError("源码版本不存在", 404);
    return JSON.parse(v.files);
  }
  restore(id: string, user: string, version: string) {
    this.assertIdle(id, user);
    const files = this.versionFiles(id, user, version);
    this.snapshot(id, user, "恢复前自动保存");
    const root = this.workspace(id, user);
    const stage = path.join(path.dirname(root), `restore-${randomUUID()}`);
    fs.mkdirSync(stage);
    const old = root + "-" + randomUUID();
    try {
      for (const [file, content] of Object.entries(files))
        this.save(stage, file, content);
      fs.renameSync(root, old);
      try {
        fs.renameSync(stage, root);
      } catch (e) {
        fs.renameSync(old, root);
        throw e;
      }
      fs.rmSync(old, { recursive: true, force: true });
      return this.snapshot(id, user, "恢复源码");
    } finally {
      fs.rmSync(stage, { recursive: true, force: true });
    }
  }
  assertIdle(id: string, user: string) {
    this.get(id, user);
    if (this.locks.has(id))
      throw new DevelopmentError("项目正在占用，请先停止当前任务", 409);
  }
  lock(id: string, user: string) {
    this.assertIdle(id, user);
    const token = Symbol();
    this.locks.set(id, token);
    return () => {
      if (this.locks.get(id) === token) this.locks.delete(id);
    };
  }
  busy(id: string, user: string) {
    this.get(id, user);
    return this.locks.has(id);
  }
}

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { closeMetaDb, createInitialAdmin, createUser, findUserById, initMetaDb } from "../src/lib/meta-sqlite.js";

describe("meta.sqlite durable publication", () => {
  const roots: string[] = [];

  afterEach(() => {
    closeMetaDb();
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  it("rolls the SQL.js memory image back to durable disk when atomic rename fails", async () => {
    const dataDir = tempDir();
    let rejectRename = false;
    const operations = operationsWith({
      renameSync(source, target) {
        if (rejectRename) throw Object.assign(new Error("injected meta rename failure"), { code: "EIO" });
        fs.renameSync(source, target);
      },
    });
    await initMetaDb(dataDir, { atomicFileOperations: operations });
    createUser("baseline", "baseline", "hash");

    rejectRename = true;
    expect(() => createUser("failed", "failed", "hash")).toThrow("injected meta rename failure");
    expect(findUserById("failed")).toBeNull();
    expect(fs.readdirSync(dataDir).filter((name) => name.includes("meta.sqlite") && name.endsWith(".tmp"))).toEqual([]);

    rejectRename = false;
    createUser("survivor", "survivor", "hash");
    closeMetaDb();
    await initMetaDb(dataDir);
    expect(findUserById("baseline")?.id).toBe("baseline");
    expect(findUserById("survivor")?.id).toBe("survivor");
    expect(findUserById("failed")).toBeNull();
  });

  it.each(["EINVAL", "EPERM", "EISDIR"])("treats unsupported parent-directory fsync code %s as a successful publication", async (code) => {
    const dataDir = tempDir();
    let armed = false;
    let fsyncCalls = 0;
    const operations = operationsWith({
      fsyncSync(descriptor) {
        if (armed && ++fsyncCalls === 2) throw Object.assign(new Error(`unsupported ${code}`), { code });
        fs.fsyncSync(descriptor);
      },
    });
    await initMetaDb(dataDir, { atomicFileOperations: operations });
    armed = true;
    expect(() => createUser(`portable-${code}`, `portable-${code}`, "hash")).not.toThrow();
    expect(fsyncCalls).toBe(2);
    armed = false;
    closeMetaDb();
    await initMetaDb(dataDir);
    expect(findUserById(`portable-${code}`)?.id).toBe(`portable-${code}`);
  });

  it("fail-stops after a post-rename parent-directory fsync error until an explicit close and reopen", async () => {
    const dataDir = tempDir();
    let armed = false;
    let failedOnce = false;
    let fsyncCalls = 0;
    const operations = operationsWith({
      fsyncSync(descriptor) {
        if (armed && !failedOnce && ++fsyncCalls === 2) {
          failedOnce = true;
          throw Object.assign(new Error("injected meta directory fsync failure"), { code: "EIO" });
        }
        fs.fsyncSync(descriptor);
      },
    });
    await initMetaDb(dataDir, { atomicFileOperations: operations });
    armed = true;
    expect(() => createUser("uncertain", "uncertain", "hash")).toThrow("injected meta directory fsync failure");
    expect(() => findUserById("uncertain")).toThrow(/commit state unknown/i);
    expect(() => createUser("after-failure", "after-failure", "hash")).toThrow(/commit state unknown/i);

    armed = false;
    closeMetaDb();
    await initMetaDb(dataDir);
    expect(findUserById("uncertain")?.id).toBe("uncertain");
    expect(findUserById("after-failure")).toBeNull();
    expect(createUser("after-reopen", "after-reopen", "hash").id).toBe("after-reopen");
  });

  it("does not mask a transactional caller's publication failure with rollback on a closed SQL.js image", async () => {
    const dataDir = tempDir();
    let rejectRename = false;
    const operations = operationsWith({
      renameSync(source, target) {
        if (rejectRename) throw Object.assign(new Error("transaction publication failed"), { code: "EIO" });
        fs.renameSync(source, target);
      },
    });
    await initMetaDb(dataDir, { atomicFileOperations: operations });
    rejectRename = true;
    expect(() => createInitialAdmin("failed-admin", "failed-admin", "hash"))
      .toThrow("transaction publication failed");
    expect(findUserById("failed-admin")).toBeNull();

    rejectRename = false;
    expect(createInitialAdmin("admin", "admin", "hash").id).toBe("admin");
  });

  it("rejects reentrant SQL mutation while a durable publication is in progress", async () => {
    const dataDir = tempDir();
    let armed = false;
    let nestedError: unknown;
    const operations = operationsWith({
      writeFileSync(file, data, options) {
        fs.writeFileSync(file, data, options as never);
        if (armed) {
          armed = false;
          try { createUser("nested", "nested", "hash"); } catch (error) { nestedError = error; }
        }
      },
    });
    await initMetaDb(dataDir, { atomicFileOperations: operations });
    armed = true;
    createUser("outer", "outer", "hash");
    expect(nestedError).toMatchObject({ message: "Meta database publication is already in progress" });
    expect(findUserById("outer")?.id).toBe("outer");
    expect(findUserById("nested")).toBeNull();
  });

  function tempDir(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "localapp-meta-durable-"));
    roots.push(root);
    return root;
  }
});

type AtomicOperations = {
  mkdirSync: typeof fs.mkdirSync;
  openSync: typeof fs.openSync;
  writeFileSync: typeof fs.writeFileSync;
  fsyncSync: typeof fs.fsyncSync;
  closeSync: typeof fs.closeSync;
  renameSync: typeof fs.renameSync;
  rmSync: typeof fs.rmSync;
};

function operationsWith(overrides: Partial<AtomicOperations>): AtomicOperations {
  return {
    mkdirSync: fs.mkdirSync.bind(fs),
    openSync: fs.openSync.bind(fs),
    writeFileSync: fs.writeFileSync.bind(fs),
    fsyncSync: fs.fsyncSync.bind(fs),
    closeSync: fs.closeSync.bind(fs),
    renameSync: fs.renameSync.bind(fs),
    rmSync: fs.rmSync.bind(fs),
    ...overrides,
  };
}

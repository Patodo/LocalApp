import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import initSqlJs from "sql.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "../../src/server.js";
import { installAppPackage } from "../../src/lib/app-installer.js";
import { writeAppPackage } from "../../src/lib/app-package.js";
import { closeMetaDb } from "../../src/lib/meta-sqlite.js";

describe("durable application installer recovery", () => {
  const roots: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    closeMetaDb();
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  it("restores the old database before Server startup after a crash between migration and activation", async () => {
    const fixture = await installedV1Fixture();
    await crashInstall(fixture.dataDir, fixture.v2Path, "after-migration", 71);

    expect(readMeta(fixture.dataDir).currentAppVersion).toBe("1.0.0");
    expect(await columns(fixture.dataDir)).toContain("upgraded");

    const app = await buildServer({ env: serverEnv(fixture.dataDir) });
    await app.ready();
    try {
      expect(readMeta(fixture.dataDir).currentAppVersion).toBe("1.0.0");
      expect(await columns(fixture.dataDir)).not.toContain("upgraded");
      expect(await rows(fixture.dataDir, "SELECT id, value FROM notes")).toEqual([["keep", "target"]]);
      expect(fs.existsSync(path.join(pageDir(fixture.dataDir), ".app-install-transaction.json"))).toBe(false);
      expect(fs.existsSync(path.join(pageDir(fixture.dataDir), "versions", "v2"))).toBe(false);
    } finally {
      await app.close();
    }
  });

  it("deterministically completes an activated install whose process crashed before journal cleanup", async () => {
    const fixture = await installedV1Fixture();
    await crashInstall(fixture.dataDir, fixture.v2Path, "after-activation", 72);

    expect(readMeta(fixture.dataDir).currentAppVersion).toBe("2.0.0");
    expect(fs.existsSync(path.join(pageDir(fixture.dataDir), ".app-install-transaction.json"))).toBe(true);

    const app = await buildServer({ env: serverEnv(fixture.dataDir) });
    await app.ready();
    try {
      expect(readMeta(fixture.dataDir).currentAppVersion).toBe("2.0.0");
      expect(await columns(fixture.dataDir)).toContain("upgraded");
      expect(await rows(fixture.dataDir, "SELECT id, value, upgraded FROM notes")).toEqual([["keep", "target", 1]]);
      expect(fs.existsSync(path.join(pageDir(fixture.dataDir), ".app-install-transaction.json"))).toBe(false);
    } finally {
      await app.close();
    }
  });

  it("fails closed and persists recovery-required when the rollback backup cannot be verified", async () => {
    const fixture = await installedV1Fixture();
    await crashInstall(fixture.dataDir, fixture.v2Path, "after-migration", 71);
    const journalPath = path.join(pageDir(fixture.dataDir), ".app-install-transaction.json");
    const journal = JSON.parse(fs.readFileSync(journalPath, "utf8")) as { database: { backupPath: string } };
    fs.appendFileSync(path.resolve(fixture.dataDir, journal.database.backupPath), "corrupt");

    await expect(buildServer({ env: serverEnv(fixture.dataDir) })).rejects.toMatchObject({
      code: "APP_INSTALL_RECOVERY_REQUIRED",
    });
    expect(JSON.parse(fs.readFileSync(journalPath, "utf8"))).toMatchObject({
      state: "recovery-required",
      issue: "Application database backup digest mismatch",
    });
    expect(readMeta(fixture.dataDir).currentAppVersion).toBe("1.0.0");
  });

  it("does not remove the installer journal before manifest and metadata are durably visible", async () => {
    const fixture = await installedV1Fixture();
    const applicationDir = pageDir(fixture.dataDir);
    const descriptors = new Map<number, string>();
    const originalOpen = fs.openSync;
    const originalFsync = fs.fsyncSync;
    const originalRename = fs.renameSync;
    const originalRm = fs.rmSync;
    let metaRenamed = false;
    let metaDirectorySynced = false;
    let durableBeforeInstallerJournalRemoval: boolean | null = null;
    vi.spyOn(fs, "openSync").mockImplementation((target, flags, mode) => {
      const descriptor = originalOpen(target, flags, mode);
      descriptors.set(descriptor, path.resolve(String(target)));
      return descriptor;
    });
    vi.spyOn(fs, "renameSync").mockImplementation((source, target) => {
      const result = originalRename(source, target);
      if (path.resolve(String(target)) === path.join(applicationDir, "meta.json")) metaRenamed = true;
      return result;
    });
    vi.spyOn(fs, "fsyncSync").mockImplementation((descriptor) => {
      const result = originalFsync(descriptor);
      if (metaRenamed && descriptors.get(descriptor) === applicationDir) metaDirectorySynced = true;
      return result;
    });
    vi.spyOn(fs, "rmSync").mockImplementation((target, options) => {
      if (path.resolve(String(target)) === path.join(applicationDir, ".app-install-transaction.json")) {
        durableBeforeInstallerJournalRemoval = metaDirectorySynced;
      }
      return originalRm(target, options);
    });

    await installAppPackage({ dataDir: fixture.dataDir, ownerId: "owner", packagePath: fixture.v2Path });
    expect(durableBeforeInstallerJournalRemoval).toBe(true);
  });

  it("keeps a committed install replay-safe when journal cleanup fsync fails after unlink", async () => {
    const fixture = await installedV1Fixture();
    const applicationDir = pageDir(fixture.dataDir);
    const transactionPath = path.join(applicationDir, ".app-install-transaction.json");
    const descriptors = new Map<number, string>();
    const originalOpen = fs.openSync;
    const originalFsync = fs.fsyncSync;
    const originalRm = fs.rmSync;
    let journalUnlinked = false;
    let cleanupFailureInjected = false;
    vi.spyOn(fs, "openSync").mockImplementation((target, flags, mode) => {
      const descriptor = originalOpen(target, flags, mode);
      descriptors.set(descriptor, path.resolve(String(target)));
      return descriptor;
    });
    vi.spyOn(fs, "rmSync").mockImplementation((target, options) => {
      const result = originalRm(target, options);
      if (path.resolve(String(target)) === transactionPath) journalUnlinked = true;
      return result;
    });
    vi.spyOn(fs, "fsyncSync").mockImplementation((descriptor) => {
      if (journalUnlinked && !cleanupFailureInjected && descriptors.get(descriptor) === applicationDir) {
        cleanupFailureInjected = true;
        const error = Object.assign(new Error("injected installer journal cleanup fsync failure"), { code: "EIO" });
        throw error;
      }
      return originalFsync(descriptor);
    });

    let installError: unknown;
    let outcome: Awaited<ReturnType<typeof installAppPackage>> | undefined;
    try {
      outcome = await installAppPackage({ dataDir: fixture.dataDir, ownerId: "owner", packagePath: fixture.v2Path });
    } catch (error) {
      installError = error;
    }

    expect.soft(cleanupFailureInjected).toBe(true);
    expect.soft(installError).toBeUndefined();
    expect.soft(outcome).toMatchObject({ appVersion: "2.0.0", localVersion: 2 });
    expect.soft(readMeta(fixture.dataDir).currentAppVersion).toBe("2.0.0");
    const currentColumns = await columns(fixture.dataDir);
    expect.soft(currentColumns).toContain("upgraded");
    if (currentColumns.includes("upgraded")) {
      expect.soft(await rows(fixture.dataDir, "SELECT id, value, upgraded FROM notes"))
        .toEqual([["keep", "target", 1]]);
    }

    const journalExists = fs.existsSync(transactionPath);
    expect.soft(journalExists).toBe(true);
    if (!journalExists) return;
    const journal = JSON.parse(fs.readFileSync(transactionPath, "utf8")) as {
      state: string;
      jobDir: string;
      database: { backupPath: string | null };
    };
    expect.soft(journal.state).toBe("committed");
    expect.soft(fs.existsSync(path.resolve(fixture.dataDir, journal.jobDir))).toBe(true);
    expect.soft(journal.database.backupPath).not.toBeNull();
    if (journal.database.backupPath) {
      expect.soft(fs.existsSync(path.resolve(fixture.dataDir, journal.database.backupPath))).toBe(true);
    }

    const committedMeta = readMeta(fixture.dataDir);
    vi.restoreAllMocks();
    const app = await buildServer({ env: serverEnv(fixture.dataDir) });
    await app.ready();
    try {
      expect(readMeta(fixture.dataDir)).toEqual(committedMeta);
      expect(readMeta(fixture.dataDir).currentAppVersion).toBe("2.0.0");
      expect(await rows(fixture.dataDir, "SELECT id, value, upgraded FROM notes"))
        .toEqual([["keep", "target", 1]]);
      expect(fs.existsSync(path.join(applicationDir, "versions", "v2"))).toBe(true);
      expect(fs.existsSync(transactionPath)).toBe(false);
      expect(fs.existsSync(path.resolve(fixture.dataDir, journal.jobDir))).toBe(false);
    } finally {
      await app.close();
    }
  });

  it("fails closed without deleting an upload named by a malicious versionPath", async () => {
    const fixture = await interruptedV2Fixture();
    const victim = path.join(pageDir(fixture.dataDir), "uploads", "protected", "keep.txt");
    fs.mkdirSync(path.dirname(victim), { recursive: true });
    fs.writeFileSync(victim, "keep-upload");
    mutateJournal(fixture.dataDir, (journal) => { journal.next.versionPath = "uploads/protected"; });

    await expectServerRecoveryRequired(fixture.dataDir);
    expect(fs.readFileSync(victim, "utf8")).toBe("keep-upload");
  });

  it("fails closed without deleting another retained package named by a malicious packagePath", async () => {
    const fixture = await interruptedV2Fixture();
    const victim = path.join(pageDir(fixture.dataDir), ".packages", "protected.localapp");
    fs.writeFileSync(victim, "keep-package");
    mutateJournal(fixture.dataDir, (journal) => { journal.next.packagePath = ".packages/protected.localapp"; });

    await expectServerRecoveryRequired(fixture.dataDir);
    expect(fs.readFileSync(victim, "utf8")).toBe("keep-package");
  });

  it("fails closed when the database backup path has the wrong exact basename", async () => {
    const fixture = await interruptedV2Fixture();
    const journal = readJournal(fixture.dataDir);
    const backup = path.resolve(fixture.dataDir, journal.database.backupPath);
    const alternate = path.join(path.dirname(backup), "alternate.db");
    fs.copyFileSync(backup, alternate);
    mutateJournal(fixture.dataDir, (value) => { value.database.backupPath = path.relative(fixture.dataDir, alternate); });

    await expectServerRecoveryRequired(fixture.dataDir);
    expect(fs.existsSync(alternate)).toBe(true);
  });

  it("fails closed when an exact backup path is replaced by a symlink", async () => {
    const fixture = await interruptedV2Fixture();
    const journal = readJournal(fixture.dataDir);
    const backup = path.resolve(fixture.dataDir, journal.database.backupPath);
    const alternate = path.join(path.dirname(backup), "attacker.db");
    fs.copyFileSync(backup, alternate);
    fs.rmSync(backup);
    fs.symlinkSync(alternate, backup);

    await expectServerRecoveryRequired(fixture.dataDir);
    expect(fs.existsSync(alternate)).toBe(true);
  });

  it("fails closed when the exact retained package path is a dangling symlink", async () => {
    const fixture = await interruptedV2Fixture();
    const journal = readJournal(fixture.dataDir);
    const packagePath = path.join(pageDir(fixture.dataDir), journal.next.packagePath);
    fs.symlinkSync(path.join(pageDir(fixture.dataDir), "uploads", "missing.localapp"), packagePath);

    await expectServerRecoveryRequired(fixture.dataDir);
    expect(fs.lstatSync(packagePath).isSymbolicLink()).toBe(true);
  });

  async function installedV1Fixture(): Promise<{ dataDir: string; v2Path: string }> {
    const dataDir = fs.mkdtempSync(path.join(path.resolve(import.meta.dirname, "../../../..", "tmp"), "localapp-installer-recovery-"));
    roots.push(dataDir);
    const v1Path = await packageFixture(dataDir, "1.0.0", [
      ["001_init.sql", "CREATE TABLE notes (id TEXT PRIMARY KEY, value TEXT); INSERT INTO notes VALUES ('keep', 'target');"],
    ]);
    const v2Path = await packageFixture(dataDir, "2.0.0", [
      ["001_init.sql", "CREATE TABLE notes (id TEXT PRIMARY KEY, value TEXT); INSERT INTO notes VALUES ('keep', 'target');"],
      ["002_upgrade.sql", "ALTER TABLE notes ADD COLUMN upgraded INTEGER NOT NULL DEFAULT 1;"],
    ]);
    await installAppPackage({ dataDir, ownerId: "owner", packagePath: v1Path });
    return { dataDir, v2Path };
  }

  async function interruptedV2Fixture(): Promise<{ dataDir: string; v2Path: string }> {
    const fixture = await installedV1Fixture();
    await crashInstall(fixture.dataDir, fixture.v2Path, "after-migration", 71);
    return fixture;
  }
});

type MutableJournal = {
  next: { versionPath: string; packagePath: string };
  database: { backupPath: string };
};

function readJournal(dataDir: string): MutableJournal {
  return JSON.parse(fs.readFileSync(path.join(pageDir(dataDir), ".app-install-transaction.json"), "utf8")) as MutableJournal;
}

function mutateJournal(dataDir: string, mutation: (journal: MutableJournal) => void): void {
  const journal = readJournal(dataDir);
  mutation(journal);
  fs.writeFileSync(path.join(pageDir(dataDir), ".app-install-transaction.json"), `${JSON.stringify(journal, null, 2)}\n`);
}

async function packageFixture(dataDir: string, version: string, migrations: Array<[string, string]>): Promise<string> {
  const outputPath = path.join(dataDir, `${version}-${crypto.randomUUID()}.localapp`);
  await writeAppPackage({
    outputPath,
    metadata: { schemaVersion: 1, appId: "crash-app", version, platformVersion: "^1.0" },
    files: [
      { path: "manifest.json", content: Buffer.from(JSON.stringify({ name: "crash-app", platformVersion: "^1.0" })) },
      { path: "dist/index.html", content: Buffer.from(version) },
      ...migrations.map(([name, sql]) => ({ path: `migrations/${name}`, content: Buffer.from(sql) })),
    ],
  });
  return outputPath;
}

async function crashInstall(dataDir: string, packagePath: string, point: string, expectedCode: number): Promise<void> {
  const tsx = path.resolve(__dirname, "../../node_modules/tsx/dist/cli.mjs");
  const worker = path.resolve(__dirname, "../fixtures/app-install-crash-worker.ts");
  const code = await new Promise<number | null>((resolve, reject) => {
    const child = spawn(process.execPath, [tsx, worker, dataDir, packagePath, point], { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.once("error", reject);
    child.once("exit", (exitCode) => exitCode === expectedCode ? resolve(exitCode) : reject(new Error(`crash worker exited ${exitCode}: ${stderr}`)));
  });
  expect(code).toBe(expectedCode);
}

async function expectServerRecoveryRequired(dataDir: string): Promise<void> {
  try {
    const app = await buildServer({ env: serverEnv(dataDir) });
    await app.close();
  } catch (error) {
    expect(error).toMatchObject({ code: "APP_INSTALL_RECOVERY_REQUIRED" });
    return;
  }
  throw new Error("Server unexpectedly started with an unsafe installer journal");
}

function pageDir(dataDir: string): string { return path.join(dataDir, "owner", "crash-app"); }
function readMeta(dataDir: string): any { return JSON.parse(fs.readFileSync(path.join(pageDir(dataDir), "meta.json"), "utf8")); }
function serverEnv(dataDir: string): NodeJS.ProcessEnv {
  return { DATA_DIR: dataDir, JWT_SECRET: `recovery-${crypto.randomUUID()}`, BOOTSTRAP_API_KEY: `bootstrap-${crypto.randomUUID()}` };
}

async function columns(dataDir: string): Promise<string[]> {
  return (await rows(dataDir, "PRAGMA table_info(notes)")).map((row) => String(row[1]));
}

async function rows(dataDir: string, sql: string): Promise<unknown[][]> {
  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync(path.join(pageDir(dataDir), "app.db")));
  try { return db.exec(sql)[0]?.values ?? []; } finally { db.close(); }
}

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import initSqlJs from "sql.js";
import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "../../src/server.js";
import { installAppPackage } from "../../src/lib/app-installer.js";
import { writeAppPackage } from "../../src/lib/app-package.js";
import { closeMetaDb } from "../../src/lib/meta-sqlite.js";

describe("durable application installer recovery", () => {
  const roots: string[] = [];

  afterEach(() => {
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

  async function installedV1Fixture(): Promise<{ dataDir: string; v2Path: string }> {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "localapp-installer-recovery-"));
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
});

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

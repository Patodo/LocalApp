import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ZipArchive } from "archiver";
import crypto from "node:crypto";
import fs from "node:fs";
import initSqlJs from "sql.js";
import { PassThrough } from "node:stream";
import path from "node:path";
import {
  createTestServer,
  getTestApiKey,
  registerUser,
} from "./helpers.js";

type PackageFile = { path: string; content: Buffer | string };

const FIXED_ARCHIVE_DATE = new Date("1980-01-01T00:00:00.000Z");

describe("atomic application package installation", () => {
  let baseUrl: string;
  let dataDir: string;
  let stop: () => Promise<void>;
  let ownerCookie: string;

  beforeAll(async () => {
    const server = await createTestServer();
    baseUrl = server.baseUrl;
    dataDir = server.dataDir;
    stop = server.stop;
    await registerUser(baseUrl, "packageowner", "package-password");
    ownerCookie = await login("packageowner", "package-password");
  });

  afterAll(async () => {
    await stop();
  });

  it("installs a portable package for the authenticated owner and restores the old version and database on migration failure", async () => {
    const firstPackage = await fixturePackage({
      name: "interview-app",
      version: "1.0.0",
      html: "<html><body>stable</body></html>",
      migrations: [["001_init.sql", "CREATE TABLE answers (id INTEGER PRIMARY KEY, value TEXT); INSERT INTO answers VALUES (1, 'stable');"]],
      manifest: { owner: "forged-owner" },
    });
    const first = await installFixturePackage(firstPackage, ownerCookie, { ownerId: "request-owner" });
    expect(first.status).toBe(201);
    expect((await first.json()).data).toMatchObject({
      name: "interview-app",
      appVersion: "1.0.0",
      localVersion: 1,
      idempotent: false,
    });

    const pageDir = path.join(dataDir, "packageowner", "interview-app");
    expect(fs.existsSync(pageDir)).toBe(true);
    expect(fs.existsSync(path.join(dataDir, "forged-owner", "interview-app"))).toBe(false);
    expect(fs.existsSync(path.join(dataDir, "request-owner", "interview-app"))).toBe(false);
    expect(JSON.parse(fs.readFileSync(path.join(pageDir, "manifest.json"), "utf8")).owner).toBeUndefined();
    const databaseBefore = sha256(fs.readFileSync(path.join(pageDir, "app.db")));

    const brokenPackage = await fixturePackage({
      name: "interview-app",
      version: "2.0.0",
      html: "<html><body>broken</body></html>",
      migrations: [
        ["001_init.sql", "CREATE TABLE answers (id INTEGER PRIMARY KEY, value TEXT); INSERT INTO answers VALUES (1, 'stable');"],
        ["002_broken.sql", "THIS IS NOT SQL"],
      ],
    });
    const broken = await installFixturePackage(brokenPackage, ownerCookie);
    expect(broken.status).toBe(400);
    expect(await broken.json()).toMatchObject({ success: false, code: "APP_MIGRATION_APPLY_FAILED", path: "002_broken.sql" });

    const meta = readMeta("packageowner", "interview-app");
    expect(meta.currentVersion).toBe(1);
    expect(meta.currentAppVersion).toBe("1.0.0");
    expect(meta.versions).toHaveLength(1);
    expect(sha256(fs.readFileSync(path.join(pageDir, "app.db")))).toBe(databaseBefore);
    expect(fs.existsSync(path.join(pageDir, "versions", "v2"))).toBe(false);
    const pageDetails = await fetch(`${baseUrl}/api/pages/interview-app`, { headers: { Cookie: ownerCookie } });
    expect((await pageDetails.json()).data.currentAppVersion).toBe("1.0.0");
    expect(fs.existsSync(path.join(dataDir, ".staging", "apps")) ? fs.readdirSync(path.join(dataDir, ".staging", "apps")) : []).toEqual([]);
    const served = await fetch(`${baseUrl}/serve/packageowner/interview-app/index.html`);
    expect(await served.text()).toBe("<html><body>stable</body></html>");
  });

  it("treats an identical appVersion and digest as idempotent and rejects a reused appVersion with another digest", async () => {
    const original = await fixturePackage({ name: "identity-app", version: "3.2.1", html: "original" });
    const installed = await installFixturePackage(original, ownerCookie);
    expect(installed.status).toBe(201);
    const firstBody = await installed.json();

    const repeated = await installFixturePackage(original, ownerCookie);
    expect(repeated.status).toBe(200);
    expect((await repeated.json()).data).toMatchObject({
      localVersion: firstBody.data.localVersion,
      appVersion: "3.2.1",
      digest: firstBody.data.digest,
      idempotent: true,
    });
    expect(readMeta("packageowner", "identity-app").versions).toHaveLength(1);

    const conflicting = await fixturePackage({ name: "identity-app", version: "3.2.1", html: "different" });
    const conflict = await installFixturePackage(conflicting, ownerCookie);
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ success: false, code: "APP_VERSION_DIGEST_CONFLICT" });
    expect(readMeta("packageowner", "identity-app")).toMatchObject({ currentVersion: 1, currentAppVersion: "3.2.1" });
  });

  it("lists stable package identities, activates a retained deployment, and rolls back to the previously active deployment", async () => {
    const v1 = await fixturePackage({ name: "activation-app", version: "1.0.0", html: "version-one" });
    const v2 = await fixturePackage({ name: "activation-app", version: "2.0.0", html: "version-two" });
    expect((await installFixturePackage(v1, ownerCookie)).status).toBe(201);
    expect((await installFixturePackage(v2, ownerCookie)).status).toBe(201);

    const versions = await fetch(`${baseUrl}/api/me/apps/activation-app/versions`, { headers: { Cookie: ownerCookie } });
    expect(versions.status).toBe(200);
    const versionsBody = await versions.json();
    expect(versionsBody.data.currentVersion).toBe(2);
    expect(versionsBody.data.currentAppVersion).toBe("2.0.0");
    expect(versionsBody.data.versions).toMatchObject([
      { version: 1, appVersion: "1.0.0", digest: expect.stringMatching(/^[a-f0-9]{64}$/) },
      { version: 2, appVersion: "2.0.0", digest: expect.stringMatching(/^[a-f0-9]{64}$/) },
    ]);

    const activated = await fetch(`${baseUrl}/api/me/apps/activation-app/versions/1/activate`, {
      method: "POST",
      headers: { Cookie: ownerCookie },
    });
    expect(activated.status).toBe(200);
    expect((await activated.json()).data).toMatchObject({ localVersion: 1, appVersion: "1.0.0" });
    expect(await (await fetch(`${baseUrl}/serve/packageowner/activation-app/index.html`)).text()).toBe("version-one");

    const rolledBack = await fetch(`${baseUrl}/api/me/apps/activation-app/rollback`, {
      method: "POST",
      headers: { Cookie: ownerCookie },
    });
    expect(rolledBack.status).toBe(200);
    expect((await rolledBack.json()).data).toMatchObject({ localVersion: 2, appVersion: "2.0.0" });
    expect(await (await fetch(`${baseUrl}/serve/packageowner/activation-app/index.html`)).text()).toBe("version-two");
  });

  it("backfills stable identities for a retained legacy deployment before listing or activating it", async () => {
    const name = "legacy-identity-app";
    const pageDir = path.join(dataDir, "packageowner", name);
    const versionDir = path.join(pageDir, "versions", "v1");
    fs.mkdirSync(versionDir, { recursive: true });
    fs.writeFileSync(path.join(versionDir, "index.html"), "legacy-version");
    fs.writeFileSync(path.join(pageDir, "meta.json"), `${JSON.stringify({
      name,
      userId: "packageowner",
      description: "",
      currentVersion: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      versions: [{ version: 1, createdAt: "2026-01-01T00:00:00.000Z", fileCount: 1, totalSize: 14 }],
      metadata: {},
    }, null, 2)}\n`);

    const versions = await fetch(`${baseUrl}/api/me/apps/${name}/versions`, { headers: { Cookie: ownerCookie } });
    expect(versions.status).toBe(200);
    expect((await versions.json()).data.versions).toEqual([
      expect.objectContaining({ version: 1, appVersion: "legacy-1", digest: expect.stringMatching(/^[a-f0-9]{64}$/) }),
    ]);

    const activation = await fetch(`${baseUrl}/api/me/apps/${name}/versions/1/activate`, {
      method: "POST",
      headers: { Cookie: ownerCookie },
    });
    expect(activation.status).toBe(200);
    expect((await activation.json()).data).toMatchObject({ localVersion: 1, appVersion: "legacy-1" });
    expect(readMeta("packageowner", name).versions[0]).toMatchObject({ appVersion: "legacy-1", digest: expect.stringMatching(/^[a-f0-9]{64}$/) });
  });

  it("keeps manifest and metadata paired when activation or rollback metadata writes fail", async () => {
    const v1 = await fixturePackage({ name: "atomic-activation-app", version: "1.0.0", html: "version-one", manifest: { description: "one" } });
    const v2 = await fixturePackage({ name: "atomic-activation-app", version: "2.0.0", html: "version-two", manifest: { description: "two" } });
    expect((await installFixturePackage(v1, ownerCookie)).status).toBe(201);
    expect((await installFixturePackage(v2, ownerCookie)).status).toBe(201);

    const pageDir = path.join(dataDir, "packageowner", "atomic-activation-app");
    const assertUnchanged = () => {
      expect(readMeta("packageowner", "atomic-activation-app")).toMatchObject({ currentVersion: 2, currentAppVersion: "2.0.0" });
      expect(JSON.parse(fs.readFileSync(path.join(pageDir, "manifest.json"), "utf8"))).toMatchObject({ description: "two" });
    };
    const originalRename = fs.renameSync;
    const rejectOneMetaWrite = () => vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      if (String(to).endsWith(`${path.sep}meta.json`)) {
        throw new Error("injected meta write failure");
      }
      return originalRename(from, to);
    });

    const activationRename = rejectOneMetaWrite();
    try {
      const response = await fetch(`${baseUrl}/api/me/apps/atomic-activation-app/versions/1/activate`, {
        method: "POST",
        headers: { Cookie: ownerCookie },
      });
      expect(response.status).toBe(400);
      assertUnchanged();
    } finally {
      activationRename.mockRestore();
    }

    const rollbackRename = rejectOneMetaWrite();
    try {
      const response = await fetch(`${baseUrl}/api/me/apps/atomic-activation-app/rollback`, {
        method: "POST",
        headers: { Cookie: ownerCookie },
      });
      expect(response.status).toBe(400);
      assertUnchanged();
    } finally {
      rollbackRename.mockRestore();
    }
  });

  it("keeps a durable deployment committed when journal cleanup fails and recovery reruns", async () => {
    const v1 = await fixturePackage({ name: "journal-cleanup-app", version: "1.0.0", html: "version-one", manifest: { description: "one" } });
    const v2 = await fixturePackage({ name: "journal-cleanup-app", version: "2.0.0", html: "version-two", manifest: { description: "two" } });
    expect((await installFixturePackage(v1, ownerCookie)).status).toBe(201);

    const pageDir = path.join(dataDir, "packageowner", "journal-cleanup-app");
    const transactionPath = path.join(pageDir, ".app-state-transaction.json");
    const originalRemove = fs.rmSync;
    const remove = vi.spyOn(fs, "rmSync").mockImplementation((target, options) => {
      if (path.resolve(String(target)) === transactionPath) {
        throw new Error("injected journal cleanup failure");
      }
      return originalRemove(target, options);
    });
    let response: Response;
    try {
      response = await installFixturePackage(v2, ownerCookie);
      expect(response.status).toBe(201);
    } finally {
      remove.mockRestore();
    }

    const versions = await fetch(`${baseUrl}/api/me/apps/journal-cleanup-app/versions`, { headers: { Cookie: ownerCookie } });
    expect(versions.status).toBe(200);
    const meta = readMeta("packageowner", "journal-cleanup-app");
    expect(meta).toMatchObject({ currentVersion: 2, currentAppVersion: "2.0.0" });
    expect(fs.existsSync(path.join(pageDir, "versions", "v2"))).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(pageDir, "manifest.json"), "utf8"))).toMatchObject({ description: "two" });
    expect(fs.existsSync(transactionPath)).toBe(false);
  });

  it("retains the previous active deployment when pruning version history so rollback remains available", async () => {
    for (let version = 1; version <= 10; version += 1) {
      const packageBytes = await fixturePackage({
        name: "retention-app",
        version: `${version}.0.0`,
        html: `version-${version}`,
      });
      expect((await installFixturePackage(packageBytes, ownerCookie)).status).toBe(201);
    }

    const activated = await fetch(`${baseUrl}/api/me/apps/retention-app/versions/1/activate`, {
      method: "POST",
      headers: { Cookie: ownerCookie },
    });
    expect(activated.status).toBe(200);

    const nextPackage = await fixturePackage({ name: "retention-app", version: "11.0.0", html: "version-11" });
    expect((await installFixturePackage(nextPackage, ownerCookie)).status).toBe(201);

    const meta = readMeta("packageowner", "retention-app");
    expect(meta.versions).toHaveLength(10);
    expect(meta.versions.map((entry: { version: number }) => entry.version)).toContain(1);

    const rolledBack = await fetch(`${baseUrl}/api/me/apps/retention-app/rollback`, {
      method: "POST",
      headers: { Cookie: ownerCookie },
    });
    expect(rolledBack.status).toBe(200);
    expect((await rolledBack.json()).data).toMatchObject({ localVersion: 1, appVersion: "1.0.0" });
    expect(await (await fetch(`${baseUrl}/serve/packageowner/retention-app/index.html`)).text()).toBe("version-1");
  });

  it("commits pruned metadata before removing obsolete deployment directories", async () => {
    for (let version = 1; version <= 10; version += 1) {
      expect((await installFixturePackage(
        await fixturePackage({ name: "prune-atomic-app", version: `${version}.0.0`, html: `version-${version}` }),
        ownerCookie,
      )).status).toBe(201);
    }
    expect((await fetch(`${baseUrl}/api/me/apps/prune-atomic-app/versions/1/activate`, {
      method: "POST",
      headers: { Cookie: ownerCookie },
    })).status).toBe(200);

    const originalRename = fs.renameSync;
    let metaRenames = 0;
    const rename = vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      if (String(to).endsWith(`${path.sep}meta.json`) && ++metaRenames === 2) {
        throw new Error("injected prune metadata failure");
      }
      return originalRename(from, to);
    });
    try {
      const response = await installFixturePackage(
        await fixturePackage({ name: "prune-atomic-app", version: "11.0.0", html: "version-11" }),
        ownerCookie,
      );
      expect(response.status).toBe(201);
    } finally {
      rename.mockRestore();
    }

    const pageDir = path.join(dataDir, "packageowner", "prune-atomic-app");
    const meta = readMeta("packageowner", "prune-atomic-app");
    expect(meta.currentVersion).toBe(11);
    for (const version of meta.versions as Array<{ version: number }>) {
      expect(fs.existsSync(path.join(pageDir, "versions", `v${version.version}`))).toBe(true);
    }
  });

  it("reinstalls an identical package when its previous deployment was pruned", async () => {
    expect((await installFixturePackage(
      await fixturePackage({ name: "pruned-identity-app", version: "1.0.0", html: "version-1" }),
      ownerCookie,
    )).status).toBe(201);
    const prunedPackage = await fixturePackage({ name: "pruned-identity-app", version: "2.0.0", html: "version-2" });
    expect((await installFixturePackage(prunedPackage, ownerCookie)).status).toBe(201);
    for (let version = 3; version <= 10; version += 1) {
      expect((await installFixturePackage(
        await fixturePackage({ name: "pruned-identity-app", version: `${version}.0.0`, html: `version-${version}` }),
        ownerCookie,
      )).status).toBe(201);
    }
    expect((await fetch(`${baseUrl}/api/me/apps/pruned-identity-app/versions/1/activate`, {
      method: "POST",
      headers: { Cookie: ownerCookie },
    })).status).toBe(200);
    expect((await installFixturePackage(
      await fixturePackage({ name: "pruned-identity-app", version: "11.0.0", html: "version-11" }),
      ownerCookie,
    )).status).toBe(201);

    const reinstalled = await installFixturePackage(prunedPackage, ownerCookie);
    expect(reinstalled.status).toBe(201);
    expect((await reinstalled.json()).data).toMatchObject({ localVersion: 12, appVersion: "2.0.0", idempotent: false });
    const pageDir = path.join(dataDir, "packageowner", "pruned-identity-app");
    expect(fs.existsSync(path.join(pageDir, "versions", "v12"))).toBe(true);
    expect(readMeta("packageowner", "pruned-identity-app").versions).toEqual(
      expect.arrayContaining([expect.objectContaining({ version: 12, appVersion: "2.0.0" })]),
    );
  });

  it("accepts an API key and binds a new application to that key's user", async () => {
    const packageBytes = await fixturePackage({ name: "api-key-app", version: "1.0.0", html: "api key" });
    const response = await installFixturePackage(packageBytes, undefined, undefined, getTestApiKey());
    expect(response.status).toBe(201);
    expect(readMeta("localadmin", "api-key-app").userId).toBe("localadmin");
  });

  it("atomically retains the exact inspected package for browser and CLI installs", async () => {
    const browserBytes = await fixturePackage({ name: "browser-retained-app", version: "1.0.0", html: "browser" });
    const cliBytes = await fixturePackage({ name: "cli-retained-app", version: "1.0.0", html: "cli" });
    expect((await installFixturePackage(browserBytes, ownerCookie)).status).toBe(201);
    expect((await installFixturePackage(cliBytes, undefined, undefined, getTestApiKey())).status).toBe(201);

    for (const [owner, name, bytes] of [
      ["packageowner", "browser-retained-app", browserBytes],
      ["localadmin", "cli-retained-app", cliBytes],
    ] as const) {
      const version = readMeta(owner, name).versions[0];
      expect(version.packagePath).toMatch(/^\.packages\/v1-[a-f0-9]{64}\.localapp$/);
      const retainedPath = path.join(dataDir, owner, name, version.packagePath);
      expect(fs.readFileSync(retainedPath)).toEqual(bytes);
      expect(sha256(fs.readFileSync(retainedPath))).toBe(version.digest);
      expect(JSON.parse(fs.readFileSync(path.join(
        dataDir,
        owner,
        name,
        "versions/v1/.localapp/migrations.snapshot.json",
      ), "utf8"))).toMatchObject({
        schemaVersion: 1,
        appVersion: "1.0.0",
        packageDigest: version.digest,
        files: [],
      });
      const hidden = await fetch(`${baseUrl}/serve/${owner}/${name}/${version.packagePath}`);
      expect(hidden.status).toBe(404);
    }
  });

  it("retains active migrations for data reset without exposing their SQL as app resources", async () => {
    const packageBytes = await fixturePackage({
      name: "migration-reset-app",
      version: "1.0.0",
      migrations: [["001_items.sql", "CREATE TABLE items (id INTEGER PRIMARY KEY);"]],
    });
    expect((await installFixturePackage(packageBytes, ownerCookie)).status).toBe(201);

    const migrationPath = path.join(
      dataDir,
      "packageowner",
      "migration-reset-app",
      "versions/v1/.localapp/migrations/001_items.sql",
    );
    expect(fs.readFileSync(migrationPath, "utf8")).toContain("CREATE TABLE items");
    const hidden = await fetch(
      `${baseUrl}/serve/packageowner/migration-reset-app/.localapp/migrations/001_items.sql`,
      { headers: { Cookie: ownerCookie } },
    );
    expect(hidden.status).toBe(404);
  });

  it("backfills a retained legacy migration snapshot before upgrade so rollback and factory reset use that version", async () => {
    const name = "legacy-migration-snapshot-app";
    const firstMigration = "CREATE TABLE version_one_records (id INTEGER PRIMARY KEY);";
    const v1 = await fixturePackage({
      name,
      version: "1.0.0",
      migrations: [["001_version_one.sql", firstMigration]],
    });
    const v2 = await fixturePackage({
      name,
      version: "2.0.0",
      migrations: [
        ["001_version_one.sql", firstMigration],
        ["002_version_two.sql", "CREATE TABLE version_two_records (id INTEGER PRIMARY KEY);"],
      ],
    });
    expect((await installFixturePackage(v1, ownerCookie)).status).toBe(201);

    const pageDir = path.join(dataDir, "packageowner", name);
    const legacyMetadataDir = path.join(pageDir, "versions/v1/.localapp");
    fs.rmSync(legacyMetadataDir, { recursive: true, force: true });
    expect(fs.existsSync(legacyMetadataDir)).toBe(false);

    expect((await installFixturePackage(v2, ownerCookie)).status).toBe(201);
    expect(fs.readFileSync(path.join(legacyMetadataDir, "migrations/001_version_one.sql"), "utf8")).toBe(firstMigration);
    expect(JSON.parse(fs.readFileSync(path.join(legacyMetadataDir, "migrations.snapshot.json"), "utf8"))).toMatchObject({
      schemaVersion: 1,
      appVersion: "1.0.0",
      packageDigest: readMeta("packageowner", name).versions[0].digest,
      files: [{ path: "001_version_one.sql", sha256: sha256(Buffer.from(firstMigration)) }],
    });

    const rolledBack = await fetch(`${baseUrl}/api/me/apps/${name}/rollback`, {
      method: "POST",
      headers: { Cookie: ownerCookie },
    });
    expect(rolledBack.status).toBe(200);
    expect((await rolledBack.json()).data).toMatchObject({ localVersion: 1, appVersion: "1.0.0" });

    fs.writeFileSync(path.join(legacyMetadataDir, "migrations/001_version_one.sql"), "corrupt");

    const reset = await fetch(`${baseUrl}/api/me/pages/${name}/data/factory-reset`, {
      method: "POST",
      headers: { Cookie: ownerCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ confirmName: name }),
    });
    expect(reset.status).toBe(200);
    expect(fs.readFileSync(path.join(legacyMetadataDir, "migrations/001_version_one.sql"), "utf8")).toBe(firstMigration);

    const SQL = await initSqlJs();
    const database = new SQL.Database(fs.readFileSync(path.join(pageDir, "app.db")));
    const tables = database.exec("SELECT name FROM sqlite_master WHERE type = 'table'")[0]?.values.flat().map(String) ?? [];
    database.close();
    expect(tables).toContain("version_one_records");
    expect(tables).not.toContain("version_two_records");
  });

  it("reports a missing retained migration package as a version-state conflict before factory reset", async () => {
    const name = "missing-migration-package-app";
    const packageBytes = await fixturePackage({
      name,
      version: "1.0.0",
      migrations: [["001_items.sql", "CREATE TABLE items (id INTEGER PRIMARY KEY);"]],
    });
    expect((await installFixturePackage(packageBytes, ownerCookie)).status).toBe(201);

    const pageDir = path.join(dataDir, "packageowner", name);
    const meta = readMeta("packageowner", name);
    const databaseBefore = sha256(fs.readFileSync(path.join(pageDir, "app.db")));
    fs.rmSync(path.join(pageDir, "versions/v1/.localapp"), { recursive: true, force: true });
    fs.rmSync(path.join(pageDir, meta.versions[0].packagePath), { force: true });

    const reset = await fetch(`${baseUrl}/api/me/pages/${name}/data/factory-reset`, {
      method: "POST",
      headers: { Cookie: ownerCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ confirmName: name }),
    });

    expect(reset.status).toBe(409);
    expect(await reset.json()).toMatchObject({ success: false, code: "APP_MIGRATIONS_UNAVAILABLE" });
    expect(sha256(fs.readFileSync(path.join(pageDir, "app.db")))).toBe(databaseBefore);
    expect(fs.existsSync(path.join(pageDir, "backups")) ? fs.readdirSync(path.join(pageDir, "backups")) : []).toEqual([]);
  });

  it("rejects a version route name that escapes the authenticated owner's app directory", async () => {
    await registerUser(baseUrl, "packagevictim", "victim-password");
    const victimCookie = await login("packagevictim", "victim-password");
    const victimPackage = await fixturePackage({ name: "private-app", version: "1.0.0", html: "victim" });
    expect((await installFixturePackage(victimPackage, victimCookie)).status).toBe(201);

    const escapedName = "..%2Fpackagevictim%2Fprivate-app";
    const versions = await fetch(`${baseUrl}/api/me/apps/${escapedName}/versions`, { headers: { Cookie: ownerCookie } });
    expect(versions.status).toBe(400);

    const activate = await fetch(`${baseUrl}/api/me/apps/${escapedName}/versions/1/activate`, {
      method: "POST",
      headers: { Cookie: ownerCookie },
    });
    expect(activate.status).toBe(400);
  });

  describe("package validation", () => {
    it.each([
      ["path traversal", async () => patchEntryName(await rawArchive([{ path: "xx/outside.txt", content: "outside" }]), "xx/outside.txt", "../outside.txt"), /unsafe|path/i],
      ["absolute paths", async () => patchEntryName(await rawArchive([{ path: "xoutside.txt", content: "outside" }]), "xoutside.txt", "/outside.txt"), /unsafe|path/i],
      ["symbolic links", async () => symlinkArchive(), /symbolic|unsupported/i],
      ["duplicate entries", async () => rawArchive([{ path: "same.txt", content: "one" }, { path: "same.txt", content: "two" }]), /duplicate/i],
      ["unsupported compression", async () => patchCompression(await fixturePackage({ name: "bad-compression", version: "1.0.0" })), /compression/i],
      ["an excessive expanded entry", async () => patchExpandedSize(await fixturePackage({ name: "oversized-entry", version: "1.0.0" })), /size|limit/i],
      ["an excessive entry count", async () => tooManyEntriesArchive(), /entries|limit/i],
    ])("rejects %s before changing application state", async (_label, makePackage, message) => {
      const packageBytes = await makePackage();
      const response = await installFixturePackage(packageBytes, ownerCookie);
      expect(response.status).toBe(400);
      expect((await response.json()).error).toMatch(message);
      expect(fs.existsSync(path.join(dataDir, "packageowner", "bad-compression"))).toBe(false);
      expect(fs.existsSync(path.join(dataDir, "packageowner", "oversized-entry"))).toBe(false);
    });

    it("rejects a mismatched checksum", async () => {
      const packageBytes = await fixturePackage({ name: "checksum-app", version: "1.0.0", checksumPath: "dist/index.html" });
      const response = await installFixturePackage(packageBytes, ownerCookie);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ success: false, code: "APP_PACKAGE_INVALID", path: "dist/index.html" });
      expect(fs.existsSync(path.join(dataDir, "packageowner", "checksum-app"))).toBe(false);
    });

    it.each([
      ["manifest.json", { omitManifest: true }],
      ["dist/index.html", { omitIndex: true }],
    ])("rejects a missing required %s", async (requiredPath, options) => {
      const packageBytes = await fixturePackage({ name: `missing-${requiredPath.startsWith("manifest") ? "manifest" : "index"}`, version: "1.0.0", ...options });
      const response = await installFixturePackage(packageBytes, ownerCookie);
      expect(response.status).toBe(400);
      expect((await response.json()).error).toContain(requiredPath);
    });

    it("rejects backend contract files outside the root declared by the manifest", async () => {
      const packageBytes = await fixturePackage({
        name: "backend-root-app",
        version: "1.0.0",
        manifest: { backend: { root: "contracts" } },
        extraFiles: [{ path: "backend/resources/tasks/queries.json", content: JSON.stringify({ queries: {} }) }],
      });
      const response = await installFixturePackage(packageBytes, ownerCookie);
      expect(response.status).toBe(400);
      expect((await response.json()).error).toMatch(/backend.*root|outside/i);
    });
  });

  async function login(username: string, password: string): Promise<string> {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    expect(response.status).toBe(200);
    const cookie = response.headers.get("set-cookie")?.match(/token=[^;]+/)?.[0];
    if (!cookie) throw new Error("Login did not return a session cookie");
    return cookie;
  }

  async function installFixturePackage(
    packageBytes: Buffer,
    cookie?: string,
    fields?: Record<string, string>,
    apiKey?: string,
  ): Promise<Response> {
    const form = new FormData();
    form.append("package", new Blob([packageBytes]), "fixture.localapp");
    for (const [name, value] of Object.entries(fields ?? {})) form.append(name, value);
    return fetch(`${baseUrl}/api/me/apps/install`, {
      method: "POST",
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        ...(apiKey ? { "X-API-Key": apiKey } : {}),
      },
      body: form,
    });
  }

  function readMeta(owner: string, name: string): any {
    return JSON.parse(fs.readFileSync(path.join(dataDir, owner, name, "meta.json"), "utf8"));
  }
});

async function fixturePackage(options: {
  name: string;
  version: string;
  html?: string;
  manifest?: Record<string, unknown>;
  migrations?: Array<[string, string]>;
  extraFiles?: PackageFile[];
  checksumPath?: string;
  omitManifest?: boolean;
  omitIndex?: boolean;
}): Promise<Buffer> {
  const manifest = {
    name: options.name,
    distDir: "dist",
    platformVersion: "^1.0",
    ...options.manifest,
  };
  const files: PackageFile[] = [
    ...(!options.omitManifest ? [{ path: "manifest.json", content: JSON.stringify(manifest) }] : []),
    ...(!options.omitIndex ? [{ path: "dist/index.html", content: options.html ?? "<html>ok</html>" }] : []),
    ...(options.migrations ?? []).map(([filename, content]) => ({ path: `migrations/${filename}`, content })),
    ...(options.extraFiles ?? []),
  ];
  const checksums = Object.fromEntries(files.map((file) => {
    const bytes = Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content);
    return [file.path, {
      sha256: file.path === options.checksumPath ? "0".repeat(64) : sha256(bytes),
      size: bytes.length,
    }];
  }));
  return rawArchive([
    { path: "package.json", content: JSON.stringify({ schemaVersion: 1, appId: options.name, version: options.version, platformVersion: "^1.0" }) },
    { path: "checksums.json", content: JSON.stringify({ schemaVersion: 1, files: checksums }) },
    ...files,
  ]);
}

async function rawArchive(entries: PackageFile[]): Promise<Buffer> {
  const output = new PassThrough();
  const chunks: Buffer[] = [];
  output.on("data", (chunk: Buffer) => chunks.push(chunk));
  const complete = new Promise<Buffer>((resolve, reject) => {
    output.on("end", () => resolve(Buffer.concat(chunks)));
    output.on("error", reject);
  });
  const archive = new ZipArchive({ zlib: { level: 9 } });
  archive.on("error", (error) => output.destroy(error));
  archive.pipe(output);
  for (const entry of entries) {
    archive.append(entry.content, { name: entry.path, date: FIXED_ARCHIVE_DATE, mode: 0o644 });
  }
  await archive.finalize();
  return complete;
}

async function symlinkArchive(): Promise<Buffer> {
  const output = new PassThrough();
  const chunks: Buffer[] = [];
  output.on("data", (chunk: Buffer) => chunks.push(chunk));
  const complete = new Promise<Buffer>((resolve, reject) => {
    output.on("end", () => resolve(Buffer.concat(chunks)));
    output.on("error", reject);
  });
  const archive = new ZipArchive();
  archive.on("error", (error) => output.destroy(error));
  archive.pipe(output);
  archive.symlink("dist/link", "../../outside");
  await archive.finalize();
  return complete;
}

async function tooManyEntriesArchive(): Promise<Buffer> {
  const entries = Array.from({ length: 10_001 }, (_, index) => ({ path: `files/${index}.txt`, content: "" }));
  return rawArchive(entries);
}

function patchCompression(archive: Buffer): Buffer {
  const patched = Buffer.from(archive);
  forEachZipHeader(patched, (offset, central) => patched.writeUInt16LE(99, offset + (central ? 10 : 8)));
  return patched;
}

function patchExpandedSize(archive: Buffer): Buffer {
  const patched = Buffer.from(archive);
  const excessive = 128 * 1024 * 1024 + 1;
  forEachZipHeader(patched, (offset, central) => patched.writeUInt32LE(excessive, offset + (central ? 24 : 22)));
  return patched;
}

function patchEntryName(archive: Buffer, from: string, to: string): Buffer {
  if (Buffer.byteLength(from) !== Buffer.byteLength(to)) throw new Error("ZIP entry replacement names must have equal lengths");
  const patched = Buffer.from(archive);
  const source = Buffer.from(from);
  const replacement = Buffer.from(to);
  let offset = 0;
  let replacements = 0;
  while ((offset = patched.indexOf(source, offset)) !== -1) {
    replacement.copy(patched, offset);
    offset += replacement.length;
    replacements += 1;
  }
  if (replacements < 2) throw new Error(`Expected local and central ZIP names for ${from}`);
  return patched;
}

function forEachZipHeader(buffer: Buffer, mutate: (offset: number, central: boolean) => void): void {
  for (let offset = 0; offset <= buffer.length - 4; offset += 1) {
    const signature = buffer.readUInt32LE(offset);
    if (signature === 0x04034b50) mutate(offset, false);
    else if (signature === 0x02014b50) mutate(offset, true);
  }
}

function sha256(content: Buffer): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

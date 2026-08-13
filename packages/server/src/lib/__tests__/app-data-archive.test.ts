import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import initSqlJs from "sql.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createDataArchive,
  extractAndValidateDataArchive,
  type AppDataArchiveManifest,
  type ArchiveLimits,
} from "../app-data-archive.js";

const limits: ArchiveLimits = {
  maxCompressedBytes: 10 * 1024 * 1024,
  maxExpandedBytes: 20 * 1024 * 1024,
  maxFileEntries: 10,
};

async function writeDatabase(filePath: string): Promise<void> {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run("CREATE TABLE records (id INTEGER PRIMARY KEY, value TEXT NOT NULL)");
  db.run("INSERT INTO records VALUES (1, 'hello')");
  fs.writeFileSync(filePath, Buffer.from(db.export()));
  db.close();
}

async function writeZip(filePath: string, entries: Array<{ name: string; body: Buffer | string }>): Promise<void> {
  const { ZipArchive } = await import("archiver");
  await new Promise<void>((resolve, reject) => {
    const output = fs.createWriteStream(filePath);
    const archive = new ZipArchive({ forceZip64: true, zlib: { level: 6 } });
    output.on("close", resolve);
    output.on("error", reject);
    archive.on("error", reject);
    archive.pipe(output);
    for (const entry of entries) archive.append(entry.body, { name: entry.name });
    void archive.finalize();
  });
}

describe("application data archive", () => {
  let tmpDir: string;
  let dbPath: string;
  let archivePath: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "localapp-data-archive-"));
    dbPath = path.join(tmpDir, "app.db");
    archivePath = path.join(tmpDir, "data.zip");
    await writeDatabase(dbPath);
  });

  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it("creates and validates a same-application archive with content and Issue files", async () => {
    const bodies = new Map([
      ["alice/demo/0123456789abcdef0123.png", Buffer.from("image")],
      ["issues/alice/demo/attachment/content", Buffer.from("issue")],
    ]);
    const created = await createDataArchive({
      outputPath: archivePath,
      databasePath: dbPath,
      application: { owner: "alice", name: "demo", version: 3 },
      objects: [...bodies].map(([key, body]) => ({ key, size: body.length })),
      openObject: async (key) => ({ body: Readable.from(bodies.get(key)!), contentType: "application/octet-stream" }),
      limits,
    });

    expect(created.manifest).toMatchObject({
      format: "localapp-app-data",
      formatVersion: 1,
      application: { owner: "alice", name: "demo", version: 3 },
      files: [
        { path: "files/000001", objectKey: "alice/demo/0123456789abcdef0123.png", size: 5 },
        { path: "files/000002", objectKey: "issues/alice/demo/attachment/content", size: 5 },
      ],
    });

    const extracted = await extractAndValidateDataArchive({
      archivePath,
      stagingDir: path.join(tmpDir, "staging"),
      expectedApplication: { owner: "alice", name: "demo", maxVersion: 3 },
      limits,
    });
    expect(fs.readFileSync(extracted.databasePath).subarray(0, 16).toString("binary")).toBe("SQLite format 3\u0000");
    expect(extracted.files.map((file) => [file.objectKey, fs.readFileSync(file.path).toString()])).toEqual([
      ["alice/demo/0123456789abcdef0123.png", "image"],
      ["issues/alice/demo/attachment/content", "issue"],
    ]);
  });

  it("records source and target object namespaces when exporting to a peer owner", async () => {
    const sourceKey = "alice/demo/0123456789abcdef0123.png";
    const created = await createDataArchive({
      outputPath: archivePath,
      databasePath: dbPath,
      application: { owner: "bob", name: "demo", version: 3 },
      sourceApplication: { owner: "alice", name: "demo" },
      objects: [{ key: sourceKey, size: 5 }],
      openObject: async () => ({ body: Readable.from(Buffer.from("image")), contentType: "image/png" }),
      limits,
    });

    expect(created.manifest.sourceApplication).toEqual({ owner: "alice", name: "demo" });
    expect(created.manifest.files[0]).toMatchObject({
      sourceObjectKey: sourceKey,
      objectKey: "bob/demo/0123456789abcdef0123.png",
    });
  });

  it("rejects a manifest for another application", async () => {
    await createDataArchive({
      outputPath: archivePath,
      databasePath: dbPath,
      application: { owner: "alice", name: "demo", version: 1 },
      objects: [],
      openObject: async () => null,
      limits,
    });

    await expect(extractAndValidateDataArchive({
      archivePath,
      stagingDir: path.join(tmpDir, "wrong-app"),
      expectedApplication: { owner: "alice", name: "other", maxVersion: 1 },
      limits,
    })).rejects.toMatchObject({ code: "APP_ARCHIVE_IDENTITY_MISMATCH" });
  });

  it("rejects duplicate and traversal entries", async () => {
    const manifest = JSON.stringify({ format: "localapp-app-data", formatVersion: 1 });
    await writeZip(archivePath, [
      { name: "localapp-data.json", body: manifest },
      { name: "database/app.db", body: fs.readFileSync(dbPath) },
      { name: "database/app.db", body: fs.readFileSync(dbPath) },
    ]);
    await expect(extractAndValidateDataArchive({
      archivePath,
      stagingDir: path.join(tmpDir, "duplicates"),
      expectedApplication: { owner: "alice", name: "demo", maxVersion: 1 },
      limits,
    })).rejects.toMatchObject({ code: "APP_ARCHIVE_DUPLICATE_ENTRY" });

    await writeZip(archivePath, [{ name: "../outside", body: "escape" }]);
    await expect(extractAndValidateDataArchive({
      archivePath,
      stagingDir: path.join(tmpDir, "traversal"),
      expectedApplication: { owner: "alice", name: "demo", maxVersion: 1 },
      limits,
    })).rejects.toMatchObject({ code: "APP_ARCHIVE_INVALID_PATH" });
  });

  it("rejects hash changes, cross-app object keys, and expanded-size overflow", async () => {
    const databaseBytes = fs.readFileSync(dbPath);
    const baseManifest: AppDataArchiveManifest = {
      format: "localapp-app-data",
      formatVersion: 1,
      createdAt: new Date().toISOString(),
      application: { owner: "alice", name: "demo", version: 1 },
      database: { path: "database/app.db", size: databaseBytes.length, sha256: crypto.createHash("sha256").update(databaseBytes).digest("hex"), schemaFingerprint: "0".repeat(64) },
      files: [{ path: "files/000001", objectKey: "mallory/demo/file.png", size: 4, sha256: "0".repeat(64) }],
    };
    await writeZip(archivePath, [
      { name: "database/app.db", body: databaseBytes },
      { name: "files/000001", body: "file" },
      { name: "localapp-data.json", body: JSON.stringify(baseManifest) },
    ]);
    await expect(extractAndValidateDataArchive({
      archivePath,
      stagingDir: path.join(tmpDir, "cross-app"),
      expectedApplication: { owner: "alice", name: "demo", maxVersion: 1 },
      limits,
    })).rejects.toMatchObject({ code: "APP_ARCHIVE_OBJECT_KEY_INVALID" });

    await expect(extractAndValidateDataArchive({
      archivePath,
      stagingDir: path.join(tmpDir, "too-large"),
      expectedApplication: { owner: "alice", name: "demo", maxVersion: 1 },
      limits: { ...limits, maxExpandedBytes: 10 },
    })).rejects.toMatchObject({ code: "APP_ARCHIVE_LIMIT_EXCEEDED" });
  });

  it("rejects object keys that escape the application namespace after normalization", async () => {
    const databaseBytes = fs.readFileSync(dbPath);
    const fileBytes = Buffer.from("escape");
    const manifest: AppDataArchiveManifest = {
      format: "localapp-app-data",
      formatVersion: 1,
      createdAt: new Date().toISOString(),
      application: { owner: "alice", name: "demo", version: 1 },
      database: {
        path: "database/app.db",
        size: databaseBytes.length,
        sha256: crypto.createHash("sha256").update(databaseBytes).digest("hex"),
        schemaFingerprint: "0".repeat(64),
      },
      files: [{
        path: "files/000001",
        objectKey: "alice/demo/../../bob/victim/file",
        size: fileBytes.length,
        sha256: crypto.createHash("sha256").update(fileBytes).digest("hex"),
      }],
    };
    await writeZip(archivePath, [
      { name: "database/app.db", body: databaseBytes },
      { name: "files/000001", body: fileBytes },
      { name: "localapp-data.json", body: JSON.stringify(manifest) },
    ]);

    await expect(extractAndValidateDataArchive({
      archivePath,
      stagingDir: path.join(tmpDir, "escaped-object-key"),
      expectedApplication: { owner: "alice", name: "demo", maxVersion: 1 },
      limits,
    })).rejects.toMatchObject({ code: "APP_ARCHIVE_OBJECT_KEY_INVALID" });
  });

  it("rejects duplicate file paths declared by the manifest", async () => {
    const databaseBytes = fs.readFileSync(dbPath);
    const fileBytes = Buffer.from("file");
    const manifest: AppDataArchiveManifest = {
      format: "localapp-app-data",
      formatVersion: 1,
      createdAt: new Date().toISOString(),
      application: { owner: "alice", name: "demo", version: 1 },
      database: {
        path: "database/app.db",
        size: databaseBytes.length,
        sha256: crypto.createHash("sha256").update(databaseBytes).digest("hex"),
        schemaFingerprint: "0".repeat(64),
      },
      files: [
        { path: "files/000001", objectKey: "alice/demo/0123456789abcdef0123.png", size: fileBytes.length, sha256: crypto.createHash("sha256").update(fileBytes).digest("hex") },
        { path: "files/000001", objectKey: "issues/alice/demo/attachment/content", size: fileBytes.length, sha256: crypto.createHash("sha256").update(fileBytes).digest("hex") },
      ],
    };
    await writeZip(archivePath, [
      { name: "database/app.db", body: databaseBytes },
      { name: "files/000001", body: fileBytes },
      { name: "localapp-data.json", body: JSON.stringify(manifest) },
    ]);

    await expect(extractAndValidateDataArchive({
      archivePath,
      stagingDir: path.join(tmpDir, "duplicate-manifest-path"),
      expectedApplication: { owner: "alice", name: "demo", maxVersion: 1 },
      limits,
    })).rejects.toMatchObject({ code: "APP_ARCHIVE_MANIFEST_INVALID" });
  });

  it("counts the manifest toward the expanded-size limit when creating an archive", async () => {
    const databaseSize = fs.statSync(dbPath).size;
    await expect(createDataArchive({
      outputPath: archivePath,
      databasePath: dbPath,
      application: { owner: "alice", name: "demo", version: 1 },
      objects: [],
      openObject: async () => null,
      limits: { ...limits, maxExpandedBytes: databaseSize + 1 },
    })).rejects.toMatchObject({ code: "APP_ARCHIVE_LIMIT_EXCEEDED" });
  });

  it("rejects a database whose schema fingerprint differs from the manifest", async () => {
    const databaseBytes = fs.readFileSync(dbPath);
    const manifest: AppDataArchiveManifest = {
      format: "localapp-app-data",
      formatVersion: 1,
      createdAt: new Date().toISOString(),
      application: { owner: "alice", name: "demo", version: 1 },
      database: {
        path: "database/app.db",
        size: databaseBytes.length,
        sha256: crypto.createHash("sha256").update(databaseBytes).digest("hex"),
        schemaFingerprint: "0".repeat(64),
      },
      files: [],
    };
    await writeZip(archivePath, [
      { name: "database/app.db", body: databaseBytes },
      { name: "localapp-data.json", body: JSON.stringify(manifest) },
    ]);

    await expect(extractAndValidateDataArchive({
      archivePath,
      stagingDir: path.join(tmpDir, "wrong-fingerprint"),
      expectedApplication: { owner: "alice", name: "demo", maxVersion: 1 },
      limits,
    })).rejects.toMatchObject({ code: "APP_ARCHIVE_SCHEMA_FINGERPRINT_MISMATCH" });
  });

  it("rejects an oversized manifest before reading it into memory", async () => {
    await writeZip(archivePath, [
      { name: "localapp-data.json", body: JSON.stringify({ padding: "x".repeat(16 * 1024 * 1024) }) },
    ]);

    await expect(extractAndValidateDataArchive({
      archivePath,
      stagingDir: path.join(tmpDir, "oversized-manifest"),
      expectedApplication: { owner: "alice", name: "demo", maxVersion: 1 },
      limits,
    })).rejects.toMatchObject({ code: "APP_ARCHIVE_LIMIT_EXCEEDED" });
  });
});

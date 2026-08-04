import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { initContentStorage, putObject, getObject, deleteObject, listAppObjects } from "../s3-client.js";
import type { ServerConfig } from "../config.js";

function minimalConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    port: 3000,
    dataDir: "",
    jwtSecret: "",
    bootstrapApiKey: "",
    templateRepoUrl: "",
    gitDownloadUrl: "",
    adminStaticDir: "",
    minCliVersion: "",
    releaseManifestUrl: "",
    llmApiKey: "",
    llmModel: "",
    llmBaseUrl: "",
    minioEndpoint: "127.0.0.1:19999", // non-existent port → ECONNREFUSED
    minioAccessKey: "none",
    minioSecretKey: "none",
    minioBucket: "test",
    adminDefaultPassword: "localadmin",
    appDataArchiveMaxBytes: 2 * 1024 * 1024 * 1024,
    appDataExpandedMaxBytes: 4 * 1024 * 1024 * 1024,
    appDataArchiveMaxFiles: 10_000,
    ...overrides,
  };
}

describe("content storage (local fallback)", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "localapp-content-test-"));
    await initContentStorage(minimalConfig({ dataDir: tmpDir }));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes and reads a file via the local fallback", async () => {
    const key = "test/file.png";
    const body = Buffer.from("fake-png-content");

    await putObject(key, body, "image/png");
    const result = await getObject(key);

    expect(result).not.toBeNull();
    expect(result!.body.equals(body)).toBe(true);
    expect(result!.contentType).toBe("image/png");
  });

  it("returns null for non-existent key", async () => {
    const result = await getObject("nonexistent/file.png");
    expect(result).toBeNull();
  });

  it("preserves binary content correctly", async () => {
    const binary = Buffer.alloc(256);
    for (let i = 0; i < 256; i++) binary[i] = i;

    await putObject("test/binary.bin", binary, "application/octet-stream");
    const result = await getObject("test/binary.bin");

    expect(result).not.toBeNull();
    expect(result!.body.equals(binary)).toBe(true);
  });

  it("stores new files in the isolated local content root", async () => {
    await putObject("dir/sub/file.txt", Buffer.from("hello"), "text/plain");

    const filePath = path.join(tmpDir, ".content/dir/sub/file.txt");
    expect(fs.existsSync(filePath)).toBe(true);
    expect(fs.readFileSync(filePath, "utf-8")).toBe("hello");
  });

  it("lists canonical and legacy application objects without application files", async () => {
    await putObject("alice/demo/0123456789abcdef0123.png", Buffer.from("image"), "image/png");
    await putObject("issues/alice/demo/019f74a1-ae2e-7220-8a2a-03b236b8ed97/content", Buffer.from("new-issue"), "application/octet-stream");

    const pageDir = path.join(tmpDir, "alice/demo");
    fs.mkdirSync(path.join(pageDir, "versions/v1"), { recursive: true });
    fs.writeFileSync(path.join(pageDir, "app.db"), "database");
    fs.writeFileSync(path.join(pageDir, "versions/v1/index.html"), "application");
    fs.writeFileSync(path.join(pageDir, "fedcba98765432100123.pdf"), "legacy-file");
    const legacyIssue = path.join(tmpDir, "issues/alice/demo/legacy-attachment/content");
    fs.mkdirSync(path.dirname(legacyIssue), { recursive: true });
    fs.writeFileSync(legacyIssue, "legacy-issue");

    const objects = await listAppObjects("alice", "demo");

    expect(objects.map(({ key }) => key)).toEqual([
      "alice/demo/0123456789abcdef0123.png",
      "alice/demo/fedcba98765432100123.pdf",
      "issues/alice/demo/019f74a1-ae2e-7220-8a2a-03b236b8ed97/content",
      "issues/alice/demo/legacy-attachment/content",
    ]);
    expect(objects.find(({ key }) => key.endsWith("fedcba98765432100123.pdf"))?.size).toBe(11);
  });

  it("deletes canonical and legacy copies of an object", async () => {
    const key = "alice/demo/0123456789abcdef0123.png";
    await putObject(key, Buffer.from("canonical"), "image/png");
    const legacyPath = path.join(tmpDir, key);
    fs.mkdirSync(path.dirname(legacyPath), { recursive: true });
    fs.writeFileSync(legacyPath, "legacy");

    await deleteObject(key);

    expect(fs.existsSync(path.join(tmpDir, ".content", key))).toBe(false);
    expect(fs.existsSync(legacyPath)).toBe(false);
  });
});

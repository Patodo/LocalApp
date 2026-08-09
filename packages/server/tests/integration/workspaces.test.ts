import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ZipArchive } from "archiver";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { closeMetaDb } from "../../src/lib/meta-sqlite.js";
import { WorkspaceStore } from "../../src/lib/workspace-store.js";
import { registerAndLogin } from "../helpers/createUser.js";
import { createTestServer, getTestApiKey } from "./helpers.js";

describe("managed workspaces", () => {
  let baseUrl: string;
  let dataDir: string;
  let stop: () => Promise<void>;
  let otherCookie: string;

  beforeAll(async () => {
    const server = await createTestServer();
    baseUrl = server.baseUrl;
    dataDir = server.dataDir;
    stop = server.stop;
    otherCookie = await registerAndLogin(baseUrl, "workspace-other", "password123");
  });

  afterAll(async () => {
    await stop();
  });

  it("creates, lists, reads, writes, and removes only caller-owned workspaces", async () => {
    const unauthenticated = await fetch(`${baseUrl}/api/workspaces`);
    expect(unauthenticated.status).toBe(401);

    const createdResponse = await fetch(`${baseUrl}/api/workspaces`, {
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify({ name: "Managed Project" }),
    });
    expect(createdResponse.status).toBe(201);
    const created = (await createdResponse.json()).data as { id: string; name: string; ownerId: string };
    expect(created).toMatchObject({ name: "Managed Project", ownerId: "localadmin" });
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(fs.statSync(path.join(dataDir, "workspaces", created.id)).isDirectory()).toBe(true);

    const write = await fetch(`${baseUrl}/api/workspaces/${created.id}/file`, {
      method: "PUT",
      headers: apiHeaders(),
      body: JSON.stringify({ path: "src/index.ts", content: "export const answer = 42;\n" }),
    });
    expect(write.status).toBe(204);

    const read = await fetch(`${baseUrl}/api/workspaces/${created.id}/file?path=${encodeURIComponent("src/index.ts")}`, {
      headers: { "X-API-Key": getTestApiKey() },
    });
    expect(read.status).toBe(200);
    expect((await read.json()).data).toEqual({ path: "src/index.ts", content: "export const answer = 42;\n" });

    const listed = await fetch(`${baseUrl}/api/workspaces`, { headers: { "X-API-Key": getTestApiKey() } });
    expect((await listed.json()).data).toEqual([expect.objectContaining({ id: created.id, name: "Managed Project" })]);

    for (const request of [
      fetch(`${baseUrl}/api/workspaces/${created.id}/file?path=src%2Findex.ts`, { headers: { Cookie: otherCookie } }),
      fetch(`${baseUrl}/api/workspaces/${created.id}`, { method: "DELETE", headers: { Cookie: otherCookie } }),
    ]) {
      expect((await request).status).toBe(404);
    }

    const removed = await fetch(`${baseUrl}/api/workspaces/${created.id}`, {
      method: "DELETE",
      headers: { "X-API-Key": getTestApiKey() },
    });
    expect(removed.status).toBe(204);
    expect(fs.existsSync(path.join(dataDir, "workspaces", created.id))).toBe(false);
  });

  it("rejects a managed workspace root replaced with a symlink", async () => {
    const createdResponse = await fetch(`${baseUrl}/api/workspaces`, {
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify({ name: "Compromised Root" }),
    });
    const workspaceId = (await createdResponse.json()).data.id as string;
    const workspacePath = path.join(dataDir, "workspaces", workspaceId);
    const outside = path.join(dataDir, "outside-workspace");
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, "secret.txt"), "outside secret");
    fs.rmSync(workspacePath, { recursive: true });
    fs.symlinkSync(outside, workspacePath);

    const response = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/file?path=secret.txt`, {
      headers: { "X-API-Key": getTestApiKey() },
    });
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("outside secret");
  });

  it("imports a bounded archive atomically and rejects archive traversal", async () => {
    closeMetaDb();
    const store = new WorkspaceStore({
      workspaceDir: path.join(dataDir, "workspaces"),
      archiveLimits: { maxCompressedBytes: 16_384, maxExpandedBytes: 32, maxFileEntries: 2 },
    });
    const validArchive = await zipFixture([
      { name: "src/index.ts", content: "hello" },
      { name: "package.json", content: "{}" },
    ]);
    const imported = await store.importArchive({ name: "Imported", ownerId: "localadmin", archivePath: validArchive });
    expect(await store.readFile(imported.id, "localadmin", "src/index.ts")).toBe("hello");

    const tooMany = await zipFixture([
      { name: "one.txt", content: "1" },
      { name: "two.txt", content: "2" },
      { name: "three.txt", content: "3" },
    ]);
    await expect(store.importArchive({ name: "Too many", ownerId: "localadmin", archivePath: tooMany }))
      .rejects.toThrow("archive limit");

    const expandedTooLarge = await zipFixture([{ name: "large.txt", content: "x".repeat(33) }]);
    await expect(store.importArchive({ name: "Too large", ownerId: "localadmin", archivePath: expandedTooLarge }))
      .rejects.toThrow("archive limit");

    const traversal = await zipFixture([{ name: "aa/escaped.txt", content: "escape" }]);
    const traversalBytes = fs.readFileSync(traversal);
    const safeName = Buffer.from("aa/escaped.txt");
    const maliciousName = Buffer.from("../escaped.txt");
    let replacements = 0;
    for (let offset = traversalBytes.indexOf(safeName); offset >= 0; offset = traversalBytes.indexOf(safeName, offset + safeName.length)) {
      maliciousName.copy(traversalBytes, offset);
      replacements += 1;
    }
    expect(replacements).toBeGreaterThanOrEqual(2);
    fs.writeFileSync(traversal, traversalBytes);
    await expect(store.importArchive({ name: "Traversal", ownerId: "localadmin", archivePath: traversal }))
      .rejects.toThrow("workspace boundary");
    expect(fs.existsSync(path.join(dataDir, "escaped.txt"))).toBe(false);

    for (const archive of [validArchive, tooMany, expandedTooLarge, traversal]) {
      fs.rmSync(path.dirname(archive), { recursive: true, force: true });
    }
  });

  it("rejects absolute and file-based clone sources without starting git", async () => {
    closeMetaDb();
    const store = new WorkspaceStore({ workspaceDir: path.join(dataDir, "workspaces") });
    await expect(store.clone({ name: "Absolute", ownerId: "localadmin", repositoryUrl: path.join(dataDir, "repo") }))
      .rejects.toThrow("absolute");
    await expect(store.clone({ name: "File URL", ownerId: "localadmin", repositoryUrl: "file:///tmp/repo" }))
      .rejects.toThrow("absolute");
    await expect(store.clone({ name: "Relative", ownerId: "localadmin", repositoryUrl: "../repo" }))
      .rejects.toThrow("local path");
  });
});

function apiHeaders(): Record<string, string> {
  return { "X-API-Key": getTestApiKey(), "Content-Type": "application/json" };
}

async function zipFixture(entries: Array<{ name: string; content: string }>): Promise<string> {
  const archivePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "localapp-workspace-archive-")), "fixture.zip");
  const output = fs.createWriteStream(archivePath);
  const archive = new ZipArchive({ zlib: { level: 9 } });
  archive.pipe(output);
  for (const entry of entries) archive.append(entry.content, { name: entry.name });
  await Promise.all([
    new Promise<void>((resolve, reject) => output.on("close", resolve).on("error", reject)),
    archive.finalize(),
  ]);
  return archivePath;
}

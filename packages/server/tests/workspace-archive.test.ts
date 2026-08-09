import { afterEach, describe, expect, it } from "vitest";
import { ZipArchive } from "archiver";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { closeMetaDb, initMetaDb } from "../src/lib/meta-sqlite.js";
import { WorkspaceStore } from "../src/lib/workspace-store.js";

const roots: string[] = [];

afterEach(() => {
  closeMetaDb();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("workspace archive confinement and cleanup", () => {
  it("enforces compressed and expanded byte limits and cleans failed imports", async () => {
    const compressed = await archiveFixture([{ name: "random.bin", content: randomBytes(2_048) }]);
    const compressedStore = await storeFixture({ maxCompressedBytes: 128, maxExpandedBytes: 8_192, maxFileEntries: 10 });
    await expectFailureClean(compressedStore, compressed, /compressed size/i);

    const expanded = await archiveFixture([{ name: "large.txt", content: "x".repeat(65) }]);
    const expandedStore = await storeFixture({ maxCompressedBytes: 8_192, maxExpandedBytes: 64, maxFileEntries: 10 });
    await expectFailureClean(expandedStore, expanded, /expanded size/i);
  });

  it("rejects normalized duplicates, backslashes, traversal, and symlink entries with no partial workspace", async () => {
    const store = await storeFixture({ maxCompressedBytes: 64 * 1024, maxExpandedBytes: 64 * 1024, maxFileEntries: 20 });

    const duplicate = await archiveFixture([
      { name: "one.txt", content: "one" },
      { name: "two.txt", content: "two" },
    ]);
    replaceArchiveName(duplicate, "two.txt", "one.txt");
    await expectFailureClean(store, duplicate, /workspace boundary/i);

    const backslash = await archiveFixture([{ name: "safe/name.txt", content: "backslash" }]);
    replaceArchiveName(backslash, "safe/name.txt", "safe\\name.txt");
    await expectFailureClean(store, backslash, /workspace boundary/i);

    const traversal = await archiveFixture([{ name: "aa/escaped.txt", content: "traversal" }]);
    replaceArchiveName(traversal, "aa/escaped.txt", "../escaped.txt");
    await expectFailureClean(store, traversal, /workspace boundary/i);

    const symlink = await archiveFixture([{ name: "outside-link", symlinkTarget: "../outside" }]);
    await expectFailureClean(store, symlink, /workspace boundary/i);
  });
});

async function storeFixture(limits: { maxCompressedBytes: number; maxExpandedBytes: number; maxFileEntries: number }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "localapp-archive-store-"));
  roots.push(root);
  await initMetaDb(root);
  return new WorkspaceStore({ workspaceDir: path.join(root, "workspaces"), archiveLimits: limits });
}

async function archiveFixture(entries: Array<{ name: string; content?: string | Buffer; symlinkTarget?: string }>): Promise<string> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "localapp-archive-fixture-"));
  roots.push(root);
  const archivePath = path.join(root, "fixture.zip");
  const output = fs.createWriteStream(archivePath);
  const archive = new ZipArchive({ zlib: { level: 9 } });
  archive.pipe(output);
  for (const entry of entries) {
    if (entry.symlinkTarget !== undefined) archive.symlink(entry.name, entry.symlinkTarget);
    else archive.append(entry.content ?? "", { name: entry.name });
  }
  await Promise.all([
    new Promise<void>((resolve, reject) => output.once("close", resolve).once("error", reject)),
    archive.finalize(),
  ]);
  return archivePath;
}

async function expectFailureClean(store: WorkspaceStore, archivePath: string, message: RegExp): Promise<void> {
  await expect(store.importArchive({ name: "Rejected", ownerId: "owner", archivePath })).rejects.toThrow(message);
  expect(store.list("owner")).toEqual([]);
  expect(fs.readdirSync(store.workspaceDir).filter((name) => name.startsWith(".tmp-"))).toEqual([]);
}

function replaceArchiveName(archivePath: string, safe: string, malicious: string): void {
  const bytes = fs.readFileSync(archivePath);
  const from = Buffer.from(safe);
  const to = Buffer.from(malicious);
  expect(to.length).toBe(from.length);
  let replacements = 0;
  for (let offset = bytes.indexOf(from); offset >= 0; offset = bytes.indexOf(from, offset + from.length)) {
    to.copy(bytes, offset);
    replacements += 1;
  }
  expect(replacements).toBeGreaterThanOrEqual(2);
  fs.writeFileSync(archivePath, bytes);
}

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { commitSourceManifestAndMeta } from "../src/lib/app-manifest.js";

describe("durable source manifest and metadata publication", () => {
  const roots: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  it("fsyncs each temporary file and parent directory before removing the recovery journal", () => {
    const pageDir = tempDir();
    const metaPath = path.join(pageDir, "meta.json");
    const events: string[] = [];
    const descriptors = observeDescriptors();
    const originalFsync = fs.fsyncSync;
    const originalRename = fs.renameSync;
    const originalRm = fs.rmSync;
    vi.spyOn(fs, "fsyncSync").mockImplementation((descriptor) => {
      events.push(`fsync:${descriptors.get(descriptor)}`);
      return originalFsync(descriptor);
    });
    vi.spyOn(fs, "renameSync").mockImplementation((source, target) => {
      events.push(`rename:${path.basename(String(target))}`);
      return originalRename(source, target);
    });
    vi.spyOn(fs, "rmSync").mockImplementation((target, options) => {
      if (path.basename(String(target)) === ".app-state-transaction.json") events.push("remove:journal");
      return originalRm(target, options);
    });

    commitSourceManifestAndMeta(pageDir, metaPath, { name: "durable" }, { currentVersion: 2 });

    for (const target of [".app-state-transaction.json", "manifest.json", "meta.json"]) {
      const renameIndex = events.indexOf(`rename:${target}`);
      expect(events.slice(0, renameIndex).some((event) => event.startsWith("fsync:") && event.includes(`${target}.`))).toBe(true);
      expect(events.slice(renameIndex + 1).some((event) => event === `fsync:${pageDir}`)).toBe(true);
    }
    const metaRename = events.indexOf("rename:meta.json");
    const durableMeta = events.indexOf(`fsync:${pageDir}`, metaRename + 1);
    expect(events.indexOf("remove:journal")).toBeGreaterThan(durableMeta);
  });

  it("keeps the recovery journal when parent fsync fails after metadata rename", () => {
    const pageDir = tempDir();
    const metaPath = path.join(pageDir, "meta.json");
    const descriptors = observeDescriptors();
    const originalFsync = fs.fsyncSync;
    const originalRename = fs.renameSync;
    let metaRenamed = false;
    vi.spyOn(fs, "renameSync").mockImplementation((source, target) => {
      const result = originalRename(source, target);
      if (path.resolve(String(target)) === metaPath) metaRenamed = true;
      return result;
    });
    vi.spyOn(fs, "fsyncSync").mockImplementation((descriptor) => {
      if (metaRenamed && descriptors.get(descriptor) === pageDir) {
        throw Object.assign(new Error("injected post-meta directory fsync failure"), { code: "EIO" });
      }
      return originalFsync(descriptor);
    });

    expect(() => commitSourceManifestAndMeta(pageDir, metaPath, { name: "durable" }, { currentVersion: 2 }))
      .toThrow("injected post-meta directory fsync failure");
    expect(fs.existsSync(path.join(pageDir, ".app-state-transaction.json"))).toBe(true);
  });

  function tempDir(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "localapp-manifest-durable-"));
    roots.push(root);
    return root;
  }
});

function observeDescriptors(): Map<number, string> {
  const descriptors = new Map<number, string>();
  const originalOpen = fs.openSync;
  vi.spyOn(fs, "openSync").mockImplementation((target, flags, mode) => {
    const descriptor = originalOpen(target, flags, mode);
    descriptors.set(descriptor, path.resolve(String(target)));
    return descriptor;
  });
  return descriptors;
}

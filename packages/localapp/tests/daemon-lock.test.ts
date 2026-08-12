import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { acquireDaemonLock } from "../src/daemon/daemon.js";
import { createRuntimeLayout } from "../src/daemon/runtime-layout.js";

const repositoryRoot = path.resolve(process.cwd(), "../..");
const testRoot = path.join(repositoryRoot, "tmp/task-7b-lock-tests");
const directories: string[] = [];

beforeAll(async () => { await fs.mkdir(testRoot, { recursive: true }); });
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true }))); });

describe("exclusive daemon lock", () => {
  it.skipIf(process.platform === "win32")("reclaims only a dead lock whose endpoint is independently unreachable", async () => {
    const layout = await fixtureLayout();
    await fs.mkdir(layout.runtimeDir, { recursive: true, mode: 0o700 });
    await fs.writeFile(layout.lockPath, `${JSON.stringify({
      schemaVersion: 1, pid: 999_999_999, bootId: "dead_boot_0123456789", endpoint: layout.controlEndpoint,
      dataRootDigest: digest(layout.dataDir), createdAt: new Date().toISOString(),
    })}\n`, { mode: 0o600 });

    const lock = await acquireDaemonLock({ layout, bootId: "live_boot_0123456789", pid: 42,
      probePid: () => "absent", probeEndpoint: async () => "unreachable" });
    expect(JSON.parse(await fs.readFile(layout.lockPath, "utf8"))).toMatchObject({ pid: 42, bootId: "live_boot_0123456789" });
    await lock.release();
    await expect(fs.lstat(layout.lockPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.skipIf(process.platform === "win32")("fails closed when a dead PID lock has an unknown endpoint probe", async () => {
    const layout = await fixtureLayout();
    await fs.mkdir(layout.runtimeDir, { recursive: true, mode: 0o700 });
    await fs.writeFile(layout.lockPath, `${JSON.stringify({
      schemaVersion: 1, pid: 999_999_999, bootId: "dead_boot_0123456789", endpoint: layout.controlEndpoint,
      dataRootDigest: digest(layout.dataDir), createdAt: new Date().toISOString(),
    })}\n`, { mode: 0o600 });

    await expect(acquireDaemonLock({ layout, bootId: "live_boot_0123456789", pid: 42,
      probePid: () => "absent", probeEndpoint: async () => "unknown" })).rejects.toMatchObject({ code: "daemon_lock_busy" });
  });

  it.skipIf(process.platform === "win32")("refuses a stale lock for a different endpoint or data root", async () => {
    const layout = await fixtureLayout();
    await fs.mkdir(layout.runtimeDir, { recursive: true, mode: 0o700 });
    await fs.writeFile(layout.lockPath, `${JSON.stringify({
      schemaVersion: 1, pid: 999_999_999, bootId: "dead_boot_0123456789", endpoint: "/other/control.sock",
      dataRootDigest: "f".repeat(64), createdAt: new Date().toISOString(),
    })}\n`, { mode: 0o600 });

    await expect(acquireDaemonLock({ layout, bootId: "live_boot_0123456789", pid: 42,
      probePid: () => "absent", probeEndpoint: async () => "unreachable" })).rejects.toMatchObject({ code: "daemon_lock_invalid" });
  });
});

async function fixtureLayout() {
  const root = await fs.mkdtemp(path.join(testRoot, "fixture-"));
  directories.push(root);
  return createRuntimeLayout({ supportDir: path.join(root, "support"), runtimeDir: path.join(root, "run"), dataDir: path.join(root, "data") });
}

function digest(value: string): string { return crypto.createHash("sha256").update(path.resolve(value)).digest("hex"); }

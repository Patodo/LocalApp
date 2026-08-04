import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { VerificationSessionStore } from "../verification-sessions.js";

describe("VerificationSessionStore startup cleanup", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  it("removes database copies left by a previous server process", () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "localapp-verification-store-"));
    roots.push(dataDir);
    const stale = path.join(dataDir, ".verification", "sessions", "stale", "app.db");
    fs.mkdirSync(path.dirname(stale), { recursive: true });
    fs.writeFileSync(stale, "stale database bytes");

    new VerificationSessionStore(dataDir).initialize();

    expect(fs.existsSync(stale)).toBe(false);
    expect(fs.existsSync(path.join(dataDir, ".verification", "sessions"))).toBe(true);
  });

  it("reserves concurrent creation slots before database snapshots complete", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "localapp-verification-store-"));
    roots.push(dataDir);
    const pageDir = path.join(dataDir, "owner", "app");
    fs.mkdirSync(pageDir, { recursive: true });
    const store = new VerificationSessionStore(dataDir);
    store.initialize();

    const results = await Promise.allSettled(Array.from({ length: 9 }, () => store.create({
      owner: "owner",
      app: "app",
      version: 1,
      identity: "member",
      pageDir,
    })));

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(8);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected).toMatchObject({
      reason: expect.objectContaining({ code: "verification_concurrency_limit", status: 429 }),
    });
  });

  it("keeps the default browser verification session active for at least fifteen minutes", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "localapp-verification-store-"));
    roots.push(dataDir);
    const pageDir = path.join(dataDir, "owner", "app");
    fs.mkdirSync(pageDir, { recursive: true });
    const store = new VerificationSessionStore(dataDir);
    store.initialize();

    const startedAt = Date.now();
    const session = await store.create({
      owner: "owner",
      app: "app",
      version: 1,
      identity: "owner",
      pageDir,
    });

    expect(Date.parse(session.expiresAt) - startedAt).toBeGreaterThanOrEqual(15 * 60 * 1000);
  });

  it("rejects an oversized database before loading it into the sql.js runtime", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "localapp-verification-store-"));
    roots.push(dataDir);
    const pageDir = path.join(dataDir, "owner", "large-app");
    fs.mkdirSync(pageDir, { recursive: true });
    fs.closeSync(fs.openSync(path.join(pageDir, "app.db"), "w"));
    fs.truncateSync(path.join(pageDir, "app.db"), 64 * 1024 * 1024 + 1);
    const store = new VerificationSessionStore(dataDir);
    store.initialize();

    await expect(store.create({
      owner: "owner",
      app: "large-app",
      version: 1,
      identity: "owner",
      pageDir,
    })).rejects.toMatchObject({ code: "verification_database_too_large", status: 413 });
  });
});

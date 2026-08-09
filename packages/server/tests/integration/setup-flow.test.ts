import { afterEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import initSqlJs from "sql.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildServer } from "../../src/server.js";
import { closeMetaDb, findUserByName } from "../../src/lib/meta-sqlite.js";
import { createTestServer } from "./helpers.js";

vi.mock("../../src/lib/platform-migrations.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/lib/platform-migrations.js")>();
  const { join } = await import("node:path");

  return {
    ...original,
    applyPlatformMigrationsToAllApps: (options: Parameters<typeof original.applyPlatformMigrationsToAllApps>[0]) =>
      original.applyPlatformMigrationsToAllApps({
        ...options,
        migrationsDir: join(options.dataDir, ".test-platform-migrations"),
      }),
  };
});

describe("first-run setup", () => {
  let stop: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await stop?.();
  });

  it("starts empty and consumes the setup token after creating the first administrator", async () => {
    const server = await createTestServer({ cleanSetup: true });
    stop = server.stop;
    const issued = server.setupTokens.issue();

    expect((await fetch(`${server.baseUrl}/api/setup/status`).then((response) => response.json())).data)
      .toEqual({ required: true });

    const created = await fetch(`${server.baseUrl}/api/setup/initialize`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: issued.token, username: "owner", password: "correct-horse-battery" }),
    });
    expect(created.status).toBe(201);
    expect(findUserByName("owner")?.role).toBe("admin");

    const replay = await fetch(`${server.baseUrl}/api/setup/initialize`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: issued.token, username: "second", password: "correct-horse-battery" }),
    });
    expect(replay.status).toBe(410);
  });

  it("rejects setup initialization requests that do not originate from loopback", async () => {
    const server = await createTestServer({ cleanSetup: true });
    stop = server.stop;
    const issued = server.setupTokens.issue();

    const rejected = await server.app.inject({
      method: "POST",
      url: "/api/setup/initialize",
      remoteAddress: "192.0.2.10",
      payload: { token: issued.token, username: "owner", password: "correct-horse-battery" },
    });

    expect(rejected.statusCode).toBe(403);
    expect((await server.app.inject({ method: "GET", url: "/api/setup/status" })).json().data).toEqual({ required: true });
  });

  it("does not migrate a legacy-looking app before first-run setup", async () => {
    const dataDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "localapp-clean-setup-"));
    const pageDir = path.join(dataDir, "legacy-owner", "legacy-app");
    const migrationsDir = path.join(dataDir, ".test-platform-migrations");
    let app: Awaited<ReturnType<typeof buildServer>> | undefined;

    try {
      fs.mkdirSync(pageDir, { recursive: true });
      const metaBefore = JSON.stringify({ name: "legacy-app", userId: "legacy-owner", status: "legacy" });
      fs.writeFileSync(path.join(pageDir, "meta.json"), metaBefore);

      const SQL = await initSqlJs();
      const database = new SQL.Database();
      database.run("CREATE TABLE users (id TEXT PRIMARY KEY)");
      const appDbBefore = Buffer.from(database.export());
      database.close();
      fs.writeFileSync(path.join(pageDir, "app.db"), appDbBefore);

      fs.mkdirSync(migrationsDir, { recursive: true });
      fs.writeFileSync(
        path.join(migrationsDir, "001_add_platform_marker.sql"),
        "ALTER TABLE users ADD COLUMN migrated_by_platform INTEGER;",
      );

      app = await buildServer({
        env: {
          DATA_DIR: dataDir,
          JWT_SECRET: "test-jwt-secret-key",
          BOOTSTRAP_API_KEY: "test-api-key-1234567890abcdef",
        },
      });

      expect(crypto.createHash("sha256").update(fs.readFileSync(path.join(pageDir, "app.db"))).digest("hex"))
        .toBe(crypto.createHash("sha256").update(appDbBefore).digest("hex"));
      expect(fs.readFileSync(path.join(pageDir, "meta.json"), "utf8")).toBe(metaBefore);
    } finally {
      await app?.close();
      closeMetaDb();
      await fs.promises.rm(dataDir, { recursive: true, force: true });
    }
  });
});

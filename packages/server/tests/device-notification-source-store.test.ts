import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DeviceNotificationSourceStore } from "../src/lib/device-notification-source-store.js";
import { closeMetaDb, createUser, deleteUserById, getDb, initMetaDb, validateApiKey, type MetaAtomicFileOperations } from "../src/lib/meta-sqlite.js";
import { SecretBox } from "../src/lib/secret-box.js";
import { loadConfig } from "../src/lib/config.js";

const fixtureRoot = path.resolve(process.cwd(), "../../tmp/task-10a-source-store");

describe("device notification source schema", () => {
  afterEach(async () => {
    closeMetaDb();
    await fs.rm(fixtureRoot, { recursive: true, force: true });
  });

  it("migrates the canonical source and generation tables idempotently", async () => {
    await fs.mkdir(fixtureRoot, { recursive: true });
    await initMetaDb(fixtureRoot);

    const tableRows = getDb().exec(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name IN ('device_notification_sources', 'device_notification_state')
      ORDER BY name
    `)[0]?.values ?? [];
    expect(tableRows.map((row) => row[0])).toEqual([
      "device_notification_sources",
      "device_notification_state",
    ]);
    expect(getDb().exec("SELECT generation FROM device_notification_state WHERE singleton = 1")[0]?.values).toEqual([[0]]);

    closeMetaDb();
    await initMetaDb(fixtureRoot);
    expect(getDb().exec("SELECT COUNT(*) FROM device_notification_state")[0]?.values).toEqual([[1]]);
  });

  it("rolls back the source and dedicated key when atomic publication fails before rename", async () => {
    await fs.mkdir(fixtureRoot, { recursive: true });
    let renames = 0;
    const operations: MetaAtomicFileOperations = {
      mkdirSync: fsSync.mkdirSync,
      openSync: fsSync.openSync,
      writeFileSync: fsSync.writeFileSync,
      fsyncSync: fsSync.fsyncSync,
      closeSync: fsSync.closeSync,
      renameSync(...args) {
        renames += 1;
        if (renames === 3) throw new Error("injected source publication failure");
        return fsSync.renameSync(...args);
      },
      rmSync: fsSync.rmSync,
    };
    await initMetaDb(fixtureRoot, { atomicFileOperations: operations });
    createUser("atomic-source-user", "atomic-source-user", "unused-password-hash");
    const store = new DeviceNotificationSourceStore(
      new SecretBox(path.join(fixtureRoot, "master.key")),
      () => "atomic-source-dedicated-key",
    );

    expect(() => store.enableLocal({
      ownerUserId: "atomic-source-user",
      sourceOrigin: "http://127.0.0.1:3210",
      sourceLabel: "Atomic source",
      expectedGeneration: 0,
    })).toThrow("injected source publication failure");

    expect(getDb().exec("SELECT COUNT(*) FROM device_notification_sources")[0]?.values).toEqual([[0]]);
    expect(getDb().exec("SELECT COUNT(*) FROM api_keys WHERE user_id = 'atomic-source-user'")[0]?.values).toEqual([[0]]);
    expect(getDb().exec("SELECT generation FROM device_notification_state WHERE singleton = 1")[0]?.values).toEqual([[0]]);
  });

  it("keeps a local source and its exact key when user deletion is rejected", async () => {
    await fs.mkdir(fixtureRoot, { recursive: true });
    await initMetaDb(fixtureRoot);
    createUser("atomic-delete-user", "atomic-delete-user", "unused-password-hash");
    const store = new DeviceNotificationSourceStore(
      new SecretBox(path.join(fixtureRoot, "master.key")),
      () => "atomic-delete-source-key",
    );
    store.enableLocal({
      ownerUserId: "atomic-delete-user",
      sourceOrigin: "http://127.0.0.1:3210",
      sourceLabel: "Atomic deletion source",
      expectedGeneration: 0,
    });
    const credential = store.snapshot().sources[0]?.credential;
    expect(credential).toBe("atomic-delete-source-key");
    getDb().run(`
      CREATE TRIGGER reject_atomic_delete_user
      BEFORE DELETE ON users WHEN OLD.id = 'atomic-delete-user'
      BEGIN SELECT RAISE(ABORT, 'injected user deletion failure'); END
    `);

    expect(() => deleteUserById("atomic-delete-user")).toThrow("injected user deletion failure");

    expect(validateApiKey(credential!)).toBe("atomic-delete-user");
    expect(store.snapshot()).toMatchObject({
      generation: 1,
      sources: [{ id: expect.any(String), enabled: true, credential }],
    });
  });

  it("rejects a notification control token shorter than 128 bits", async () => {
    await expect(loadConfig({
      DATA_DIR: path.join(fixtureRoot, "short-token-config"),
      LOCALAPP_NOTIFICATION_CONTROL_TOKEN: "too-short",
    })).rejects.toThrow("LOCALAPP_NOTIFICATION_CONTROL_TOKEN must contain at least 128 bits");
  });

  it("releases an already-cancelled generation wait without retaining its timeout", async () => {
    await fs.mkdir(fixtureRoot, { recursive: true });
    await initMetaDb(fixtureRoot);
    const store = new DeviceNotificationSourceStore(new SecretBox(path.join(fixtureRoot, "master.key")));
    const controller = new AbortController();
    controller.abort();

    const outcome = await Promise.race([
      store.waitForGeneration(0, 1_000, controller.signal).then(() => "released"),
      new Promise<string>((resolve) => setTimeout(() => resolve("retained"), 50)),
    ]);
    expect(outcome).toBe("released");
  });
});

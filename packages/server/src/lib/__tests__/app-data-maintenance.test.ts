import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertAppDataWritable,
  isAppDataMaintenanceActive,
  withAppDataObjectWrite,
  withAppDataMaintenance,
} from "../app-data-maintenance.js";
import { withDbQueue } from "../app-db.js";

describe("application data maintenance", () => {
  const pageDir = path.join(os.tmpdir(), "localapp-maintenance-alice-demo");

  afterEach(() => {
    expect(isAppDataMaintenanceActive(pageDir)).toBe(false);
  });

  it("blocks a second operation and application writes for the same app", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const first = withAppDataMaintenance(pageDir, async () => held);

    await vi.waitFor(() => expect(isAppDataMaintenanceActive(pageDir)).toBe(true));
    expect(() => assertAppDataWritable(pageDir)).toThrow(expect.objectContaining({ code: "APP_DATA_MAINTENANCE" }));
    await expect(withAppDataMaintenance(pageDir, async () => undefined)).rejects.toMatchObject({ code: "APP_DATA_OPERATION_BUSY" });

    release();
    await first;
  });

  it("allows another application to operate independently", async () => {
    const otherPageDir = path.join(os.tmpdir(), "localapp-maintenance-alice-other");
    await withAppDataMaintenance(pageDir, async () => {
      expect(() => assertAppDataWritable(otherPageDir)).not.toThrow();
      await expect(withAppDataMaintenance(otherPageDir, async () => "ok")).resolves.toBe("ok");
    });
  });

  it("waits for an existing database operation before entering maintenance", async () => {
    let releaseDb!: () => void;
    let checkExistingWrite!: () => void;
    const dbHeld = new Promise<void>((resolve) => { releaseDb = resolve; });
    const existing = withDbQueue(path.join(pageDir, "app.db"), async () => {
      checkExistingWrite = () => assertAppDataWritable(pageDir, true);
      return dbHeld;
    });
    await Promise.resolve();

    let releaseMaintenance!: () => void;
    const maintenanceHeld = new Promise<void>((resolve) => { releaseMaintenance = resolve; });
    const maintenance = withAppDataMaintenance(pageDir, async () => maintenanceHeld);
    await Promise.resolve();

    expect(isAppDataMaintenanceActive(pageDir)).toBe(false);
    expect(() => assertAppDataWritable(pageDir)).toThrow(expect.objectContaining({ code: "APP_DATA_MAINTENANCE" }));
    expect(() => checkExistingWrite()).not.toThrow();
    await expect(withAppDataMaintenance(pageDir, async () => undefined)).rejects.toMatchObject({ code: "APP_DATA_OPERATION_BUSY" });

    releaseDb();
    await existing;
    await vi.waitFor(() => expect(isAppDataMaintenanceActive(pageDir)).toBe(true));
    releaseMaintenance();
    await maintenance;
  });

  it("waits for an existing object write and rejects new writes after maintenance is reserved", async () => {
    let releaseWrite!: () => void;
    const writeHeld = new Promise<void>((resolve) => { releaseWrite = resolve; });
    const write = withAppDataObjectWrite(pageDir, async () => writeHeld);
    await Promise.resolve();

    const maintenance = withAppDataMaintenance(pageDir, async () => "done");
    await expect(withAppDataObjectWrite(pageDir, async () => undefined)).rejects.toMatchObject({ code: "APP_DATA_MAINTENANCE" });
    expect(isAppDataMaintenanceActive(pageDir)).toBe(false);

    releaseWrite();
    await write;
    await expect(maintenance).resolves.toBe("done");
  });
});

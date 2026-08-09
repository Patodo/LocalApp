import { describe, it, expect, afterAll } from "vitest";
import { initMetaDb, closeMetaDb, listUsers } from "../src/lib/meta-sqlite.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

describe("bootstrap admin", () => {
  let dataDir: string;

  async function freshDb() {
    closeMetaDb();
    dataDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "qw-bootstrap-test-"));
    await initMetaDb(dataDir);
  }

  afterAll(async () => {
    closeMetaDb();
    if (dataDir) await fs.promises.rm(dataDir, { recursive: true, force: true });
  });

  it("initializes a fresh database without users", async () => {
    await freshDb();
    expect(listUsers(1, 10)).toMatchObject({ data: [], total: 0 });
  });
});

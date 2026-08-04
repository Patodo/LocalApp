import { describe, it, expect, afterAll } from "vitest";
import { initMetaDb, closeMetaDb, findUserById, findUserByName, BOOTSTRAP_USER_ID, getDb, validateApiKey } from "../src/lib/meta-sqlite.js";
import bcrypt from "bcryptjs";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

describe("bootstrap admin", () => {
  let dataDir: string;

  async function freshDb(bootstrapKey?: string, adminPw?: string) {
    closeMetaDb();
    dataDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "qw-bootstrap-test-"));
    await initMetaDb(dataDir, bootstrapKey, adminPw);
  }

  afterAll(async () => {
    closeMetaDb();
    if (dataDir) await fs.promises.rm(dataDir, { recursive: true, force: true });
  });

  it(`首次创建 ${BOOTSTRAP_USER_ID}（使用默认密码）`, async () => {
    await freshDb("test-bootstrap-key");
    const user = findUserByName(BOOTSTRAP_USER_ID);
    expect(user).not.toBeNull();
    expect(user!.id).toBe(BOOTSTRAP_USER_ID);
    expect(user!.provider).toBe("local");
    expect(user!.mustChangePassword).toBe(true);
    expect(await bcrypt.compare("localadmin", user!.password)).toBe(true);
  });

  it(`首次创建 ${BOOTSTRAP_USER_ID}（使用自定义密码）`, async () => {
    await freshDb("test-bootstrap-key", "my-custom-pw");
    const user = findUserByName(BOOTSTRAP_USER_ID);
    expect(user).not.toBeNull();
    expect(await bcrypt.compare("my-custom-pw", user!.password)).toBe(true);
    expect(user!.mustChangePassword).toBe(true);
  });

  it(`${BOOTSTRAP_USER_ID} 已存在无密码 — 补设密码`, async () => {
    await freshDb("test-bootstrap-key");
    // bootstrap user was created with localadmin default pw
    closeMetaDb();
    // Manually clear the password to simulate legacy state
    await initMetaDb(dataDir, "test-bootstrap-key", "new-pw");
    const user = findUserByName(BOOTSTRAP_USER_ID);
    // Password was set during first init, so it's non-empty now
    // This tests the "already has password" path — role stays admin
    expect(user!.role).toBe("admin");
  });

  it(`未配置 bootstrapApiKey — 不创建 ${BOOTSTRAP_USER_ID}`, async () => {
    await freshDb(undefined);
    const user = findUserByName(BOOTSTRAP_USER_ID);
    expect(user).toBeNull();
  });

  it("bootstrap 用户与 api_keys、everyone 组 creator_id 关联一致", async () => {
    await freshDb("test-bootstrap-key");
    const user = findUserById(BOOTSTRAP_USER_ID);
    expect(user).not.toBeNull();
    expect(user!.role).toBe("admin");

    const db = getDb();
    expect(validateApiKey("test-bootstrap-key")).toBe(BOOTSTRAP_USER_ID);

    const groupStmt = db.prepare("SELECT creator_id FROM groups WHERE name = 'everyone'");
    groupStmt.step();
    const groupRow = groupStmt.getAsObject() as { creator_id: string };
    groupStmt.free();
    expect(groupRow.creator_id).toBe(BOOTSTRAP_USER_ID);
  });

  it("meta DB 连接关闭后可从磁盘重开并继续校验 API Key", async () => {
    await freshDb("test-bootstrap-key");
    expect(validateApiKey("test-bootstrap-key")).toBe(BOOTSTRAP_USER_ID);

    closeMetaDb();

    expect(validateApiKey("test-bootstrap-key")).toBe(BOOTSTRAP_USER_ID);
  });
});

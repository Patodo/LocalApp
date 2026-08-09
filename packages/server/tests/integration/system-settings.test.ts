import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildServer } from "../../src/server.js";
import { closeMetaDb } from "../../src/lib/meta-sqlite.js";
import { SetupTokenStore } from "../../src/lib/setup-token-store.js";

describe("system settings", () => {
  let stop: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await stop?.();
    stop = undefined;
  });

  it("persists a validated network change and requests supervised restart", async () => {
    closeMetaDb();
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "localapp-system-settings-"));
    const requestRestart = vi.fn();
    const setupTokens = new SetupTokenStore();
    const app = await buildServer({
      env: {
        DATA_DIR: dataDir,
        BOOTSTRAP_API_KEY: "system-settings-api-key",
        JWT_SECRET: "test-jwt-secret",
      },
      setupTokens,
      restartController: { requestRestart },
    });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.addresses()[0];
    if (!address || typeof address === "string") throw new Error("Expected TCP listener");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    stop = async () => {
      await app.close();
      closeMetaDb();
      fs.rmSync(dataDir, { recursive: true, force: true });
    };

    const issued = setupTokens.issue();
    const setup = await fetch(`${baseUrl}/api/setup/initialize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: issued.token, username: "owner", password: "correct-horse-battery" }),
    });
    expect(setup.status).toBe(201);

    const response = await fetch(`${baseUrl}/api/system/settings/network`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-API-Key": "system-settings-api-key" },
      body: JSON.stringify({ listenHost: "0.0.0.0", listenPort: 43127, allowInsecureLan: true }),
    });

    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ success: true, data: { restarting: true } });
    expect(requestRestart).toHaveBeenCalledWith(75);
    expect(JSON.parse(fs.readFileSync(path.join(dataDir, "server.json"), "utf8"))).toMatchObject({
      listenHost: "0.0.0.0",
      listenPort: 43127,
      allowInsecureLan: true,
    });
  });
});

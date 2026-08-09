import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import * as fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildServer } from "../../src/server.js";
import { closeMetaDb } from "../../src/lib/meta-sqlite.js";
import { SetupTokenStore } from "../../src/lib/setup-token-store.js";
import { createServerConfigStore } from "../../src/lib/server-config-store.js";

describe("system settings", () => {
  let stop: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await stop?.();
    stop = undefined;
  });

  it("persists a validated network change and requests supervised restart", async () => {
    closeMetaDb();
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "localapp-system-settings-"));
    fs.writeFileSync(path.join(dataDir, "server.json"), JSON.stringify({
      listenHost: "127.0.0.1",
      listenPort: 3000,
      publicUrl: "",
      workspaceDir: "workspaces",
      allowInsecureLan: false,
    }));
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
      listenHost: "127.0.0.1",
      listenPort: 3000,
      allowInsecureLan: false,
    });
    expect(JSON.parse(fs.readFileSync(path.join(dataDir, "server.pending.json"), "utf8"))).toMatchObject({
      previous: { listenHost: "127.0.0.1", listenPort: 3000, allowInsecureLan: false },
      candidate: { listenHost: "0.0.0.0", listenPort: 43127, allowInsecureLan: true },
    });
  });

  it("rejects a web rebind when an environment variable controls network settings", async () => {
    closeMetaDb();
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "localapp-system-settings-"));
    const requestRestart = vi.fn();
    const setupTokens = new SetupTokenStore();
    const app = await buildServer({
      env: {
        DATA_DIR: dataDir,
        BOOTSTRAP_API_KEY: "system-settings-api-key",
        JWT_SECRET: "test-jwt-secret",
        LISTEN_PORT: "43126",
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
    expect((await fetch(`${baseUrl}/api/setup/initialize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: issued.token, username: "owner", password: "correct-horse-battery" }),
    })).status).toBe(201);

    const response = await fetch(`${baseUrl}/api/system/settings/network`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-API-Key": "system-settings-api-key" },
      body: JSON.stringify({ listenHost: "127.0.0.1", listenPort: 43127, allowInsecureLan: false }),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ success: false, error: expect.stringContaining("LISTEN_PORT") });
    expect(requestRestart).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(dataDir, "server.pending.json"))).toBe(false);
  });

  it("continues a web rebind after the pending-file directory fsync fails post-rename", async () => {
    closeMetaDb();
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "localapp-system-settings-"));
    const requestRestart = vi.fn();
    const setupTokens = new SetupTokenStore();
    const env = {
      DATA_DIR: dataDir,
      BOOTSTRAP_API_KEY: "system-settings-api-key",
      JWT_SECRET: "test-jwt-secret",
    };
    const directorySyncError = Object.assign(new Error("injected post-rename directory fsync failure"), { code: "EIO" });
    const configStore = createServerConfigStore({
      env,
      atomicFileOperations: {
        mkdir: fsPromises.mkdir,
        rename: fsPromises.rename,
        rm: fsPromises.rm,
        open: async (filePath, flags, mode) => {
          const handle = await fsPromises.open(filePath, flags, mode);
          if (String(filePath) === dataDir && flags === "r") {
            return {
              close: handle.close.bind(handle),
              chmod: handle.chmod.bind(handle),
              writeFile: handle.writeFile.bind(handle),
              sync: async () => { throw directorySyncError; },
            } as typeof handle;
          }
          return handle;
        },
      },
    });
    const app = await buildServer({
      env,
      configStore,
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
    expect((await fetch(`${baseUrl}/api/setup/initialize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: issued.token, username: "owner", password: "correct-horse-battery" }),
    })).status).toBe(201);
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    try {
      const response = await fetch(`${baseUrl}/api/system/settings/network`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-API-Key": "system-settings-api-key" },
        body: JSON.stringify({ listenHost: "127.0.0.1", listenPort: 43128, allowInsecureLan: false }),
      });

      expect(response.status).toBe(202);
      expect(requestRestart).toHaveBeenCalledWith(75);
      expect(JSON.parse(fs.readFileSync(path.join(dataDir, "server.pending.json"), "utf8"))).toMatchObject({
        candidate: { listenPort: 43128 },
      });
      expect(warning).toHaveBeenCalledWith(
        expect.stringContaining("directory fsync failed after commit"),
        directorySyncError,
      );
    } finally {
      warning.mockRestore();
    }
  });
});

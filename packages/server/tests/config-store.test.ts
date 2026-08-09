import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/lib/config.js";
import { createServerConfigStore } from "../src/lib/server-config-store.js";

describe("ServerConfigStore", () => {
  const directories: string[] = [];

  afterEach(() => {
    directories.splice(0).forEach((directory) => fs.rmSync(directory, { recursive: true, force: true }));
  });

  it("defaults to loopback and rejects LAN binding without acknowledgement", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "localapp-server-config-"));
    directories.push(dataDir);
    const config = await loadConfig({ DATA_DIR: dataDir, JWT_SECRET: "secret" });
    const store = createServerConfigStore({ env: { DATA_DIR: dataDir, JWT_SECRET: "secret" } });

    expect(config.listenHost).toBe("127.0.0.1");
    await expect(store.validate({ ...config, listenHost: "0.0.0.0" }))
      .rejects.toThrow("allowInsecureLan");
  });

  it("writes only public settings and keeps environment overrides authoritative", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "localapp-server-config-"));
    directories.push(dataDir);
    const env = { DATA_DIR: dataDir, JWT_SECRET: "environment-secret", LISTEN_PORT: "43126" };
    const store = createServerConfigStore({ env });
    const config = await store.read();

    await store.write(await store.validate({
      ...config,
      listenHost: "127.0.0.1",
      listenPort: 43127,
      publicUrl: "https://localapp.example",
      workspaceDir: "workspaces",
    }));

    expect(JSON.parse(fs.readFileSync(path.join(dataDir, "server.json"), "utf8"))).toEqual({
      listenHost: "127.0.0.1",
      listenPort: 43127,
      publicUrl: "https://localapp.example",
      workspaceDir: path.join(dataDir, "workspaces"),
      allowInsecureLan: false,
    });
    await expect(store.read()).resolves.toMatchObject({
      listenPort: 43126,
      jwtSecret: "environment-secret",
    });
  });
});

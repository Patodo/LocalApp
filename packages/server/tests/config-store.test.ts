import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import * as fsPromises from "node:fs/promises";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/lib/config.js";
import { createServerConfigStore } from "../src/lib/server-config-store.js";
import { isLoopbackAddress } from "../src/lib/loopback.js";

describe("ServerConfigStore", () => {
  const directories: string[] = [];
  const execFileAsync = promisify(execFile);

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

  it("defaults workspaceDir exactly under dataDir and accepts a confined relative override", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "localapp-server-config-"));
    directories.push(dataDir);

    await expect(loadConfig({ DATA_DIR: dataDir, JWT_SECRET: "secret" })).resolves.toMatchObject({
      workspaceDir: path.join(dataDir, "workspaces"),
    });
    await expect(loadConfig({ DATA_DIR: dataDir, WORKSPACE_DIR: "studio/projects", JWT_SECRET: "secret" })).resolves.toMatchObject({
      workspaceDir: path.join(dataDir, "studio", "projects"),
    });
  });

  it("rejects absolute, traversal, and symlink workspaceDir escapes", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "localapp-server-config-"));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "localapp-server-config-outside-"));
    directories.push(dataDir, outside);
    fs.symlinkSync(outside, path.join(dataDir, "linked-outside"));

    for (const workspaceDir of [outside, "../outside", "linked-outside/projects"]) {
      await expect(loadConfig({ DATA_DIR: dataDir, WORKSPACE_DIR: workspaceDir, JWT_SECRET: "secret" }))
        .rejects.toThrow("workspaceDir");
    }
  });

  it("rejects an outside workspaceDir supplied through persisted settings validation", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "localapp-server-config-"));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "localapp-server-config-outside-"));
    directories.push(dataDir, outside);
    const store = createServerConfigStore({ env: { DATA_DIR: dataDir, JWT_SECRET: "secret" } });
    const config = await store.read();

    await expect(store.validate({ ...config, workspaceDir: outside })).rejects.toThrow("workspaceDir");
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
      workspaceDir: "workspaces",
      allowInsecureLan: false,
    });
    await expect(store.read()).resolves.toMatchObject({
      listenPort: 43126,
      jwtSecret: "environment-secret",
    });
  });

  it("recognizes the complete IPv4 loopback range", () => {
    expect(isLoopbackAddress("127.0.0.2")).toBe(true);
    expect(isLoopbackAddress("127.255.255.255")).toBe(true);
    expect(isLoopbackAddress("::1")).toBe(true);
    expect(isLoopbackAddress("128.0.0.1")).toBe(false);
  });

  it("atomically replaces server settings and repairs existing JWT key permissions", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "localapp-server-config-"));
    directories.push(dataDir);
    const settingsPath = path.join(dataDir, "server.json");
    const jwtKeyPath = path.join(dataDir, "jwt.key");
    fs.writeFileSync(settingsPath, "{}", { mode: 0o600 });
    const originalInode = fs.statSync(settingsPath).ino;
    fs.writeFileSync(jwtKeyPath, "B".repeat(43), { mode: 0o644 });
    fs.chmodSync(jwtKeyPath, 0o644);

    const store = createServerConfigStore({ env: { DATA_DIR: dataDir } });
    const config = await store.read();
    await store.write(await store.validate({ ...config, listenPort: 43127 }));

    expect(fs.statSync(settingsPath).ino).not.toBe(originalInode);
    expect(fs.readFileSync(jwtKeyPath, "utf8")).toBe("B".repeat(43));
    if (process.platform !== "win32") {
      expect(fs.statSync(settingsPath).mode & 0o777).toBe(0o600);
      expect(fs.statSync(jwtKeyPath).mode & 0o777).toBe(0o600);
    }
  });

  it.each(["write", "chmod", "fsync", "rename"])("cleans the private settings temporary file when %s fails", async (failure) => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "localapp-server-config-"));
    directories.push(dataDir);
    const store = createServerConfigStore({
      env: { DATA_DIR: dataDir, JWT_SECRET: "test-secret" },
      atomicFileOperations: {
        mkdir: fsPromises.mkdir,
        rename: async (oldPath, newPath) => {
          if (failure === "rename") throw new Error("injected settings rename failure");
          await fsPromises.rename(oldPath, newPath);
        },
        rm: fsPromises.rm,
        open: async (filePath, flags, mode) => {
          const handle = await fsPromises.open(filePath, flags, mode);
          if (String(filePath).includes(".server.json.")) {
            return {
              close: handle.close.bind(handle),
              chmod: failure === "chmod"
                ? async () => { throw new Error("injected settings chmod failure"); }
                : handle.chmod.bind(handle),
              sync: failure === "fsync"
                ? async () => { throw new Error("injected settings fsync failure"); }
                : handle.sync.bind(handle),
              writeFile: failure === "write"
                ? async () => { throw new Error("injected settings write failure"); }
                : handle.writeFile.bind(handle),
            } as typeof handle;
          }
          return handle;
        },
      },
    });
    const config = await store.read();

    await expect(store.write({ ...config, listenPort: 43127 })).rejects.toThrow(`injected settings ${failure} failure`);

    expect(fs.readdirSync(dataDir).filter((name) => name.includes(".server.json.") && name.endsWith(".tmp"))).toEqual([]);
  });

  it("keeps the pending network configuration staged when directory fsync fails after rename", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "localapp-server-config-"));
    directories.push(dataDir);
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const directorySyncError = Object.assign(new Error("injected post-rename directory fsync failure"), { code: "EIO" });
    const store = createServerConfigStore({
      env: { DATA_DIR: dataDir, JWT_SECRET: "test-secret" },
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
    const config = await store.read();
    const candidate = await store.validate({ ...config, listenPort: 43127 });

    await expect(store.stageNetworkChange(candidate)).resolves.toBeUndefined();

    expect(JSON.parse(fs.readFileSync(path.join(dataDir, "server.pending.json"), "utf8"))).toMatchObject({
      candidate: { listenPort: 43127 },
    });
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining("directory fsync failed after commit"),
      directorySyncError,
    );
    expect(fs.readdirSync(dataDir).filter((name) => name.includes(".server.pending.json.") && name.endsWith(".tmp"))).toEqual([]);
  });

  it("gives concurrent first-start readers one complete JWT secret", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "localapp-server-config-"));
    directories.push(dataDir);
    const moduleUrl = new URL("../src/lib/config.ts", import.meta.url).href;
    const program = [
      `import { loadConfig } from ${JSON.stringify(moduleUrl)};`,
      `loadConfig({ DATA_DIR: ${JSON.stringify(dataDir)} })`,
      ".then((config) => process.stdout.write(config.jwtSecret))",
      ".catch((error) => { console.error(error); process.exit(1); });",
    ].join("");

    const outputs = await Promise.all(Array.from({ length: 12 }, async () => {
      const { stdout } = await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", program], {
        cwd: path.resolve(import.meta.dirname, ".."),
      });
      return stdout.trim();
    }));

    expect(new Set(outputs).size).toBe(1);
    expect(outputs[0]).toMatch(/^[A-Za-z0-9_-]{43}$/);
    if (process.platform !== "win32") expect(fs.statSync(path.join(dataDir, "jwt.key")).mode & 0o777).toBe(0o600);
  });

  it("does not return an incomplete JWT key observed during first creation", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "localapp-server-config-"));
    directories.push(dataDir);
    const jwtKeyPath = path.join(dataDir, "jwt.key");
    const expectedSecret = "A".repeat(43);
    fs.writeFileSync(jwtKeyPath, "", { mode: 0o600 });
    const writer = spawn(process.execPath, ["--eval", `setTimeout(() => require("node:fs").writeFileSync(${JSON.stringify(jwtKeyPath)}, ${JSON.stringify(expectedSecret)}), 40)`]);

    try {
      expect((await loadConfig({ DATA_DIR: dataDir })).jwtSecret).toBe(expectedSecret);
    } finally {
      await once(writer, "exit");
    }
  });

  it("publishes a complete JWT key when hard-link publication is unsupported", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "localapp-server-config-"));
    directories.push(dataDir);
    const unsupported = Object.assign(new Error("hard links unsupported"), { code: "EOPNOTSUPP" });
    const link = vi.spyOn(fs, "linkSync").mockImplementation(() => { throw unsupported; });

    try {
      const config = await loadConfig({ DATA_DIR: dataDir });
      expect(config.jwtSecret).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(fs.readdirSync(dataDir).filter((name) => name.includes("jwt.key") && name.endsWith(".tmp"))).toEqual([]);
      expect(fs.existsSync(path.join(dataDir, "jwt.key.lock"))).toBe(true);
      if (process.platform !== "win32") expect(fs.statSync(path.join(dataDir, "jwt.key")).mode & 0o777).toBe(0o600);
    } finally {
      link.mockRestore();
    }
  });

  it("gives concurrent readers one complete JWT key when hard links are unsupported", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "localapp-server-config-"));
    directories.push(dataDir);
    const moduleUrl = new URL("../src/lib/config.ts", import.meta.url).href;
    const preload = path.resolve(import.meta.dirname, "fixtures/no-hard-link.cjs");
    const program = [
      `import { loadConfig } from ${JSON.stringify(moduleUrl)};`,
      `loadConfig({ DATA_DIR: ${JSON.stringify(dataDir)} })`,
      ".then((config) => process.stdout.write(config.jwtSecret))",
      ".catch((error) => { console.error(error); process.exit(1); });",
    ].join("");

    const outputs = await Promise.all(Array.from({ length: 12 }, async () => {
      const { stdout } = await execFileAsync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", program], {
        cwd: path.resolve(import.meta.dirname, ".."),
        env: { ...process.env, NODE_OPTIONS: `--require ${preload}` },
      });
      return stdout.trim();
    }));

    expect(new Set(outputs).size).toBe(1);
    expect(outputs[0]).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(fs.readdirSync(dataDir).filter((name) => name.includes("jwt.key") && name.endsWith(".tmp"))).toEqual([]);
    expect(fs.existsSync(path.join(dataDir, "jwt.key.lock"))).toBe(true);
  });

  it("does not steal an aged live fallback lock or publish competing JWT keys", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "localapp-server-config-"));
    directories.push(dataDir);
    const jwtKeyPath = path.join(dataDir, "jwt.key");
    const lockPath = `${jwtKeyPath}.lock`;
    const lockMarker = "live-lock-owner";
    const lockDescriptor = fs.openSync(lockPath, "wx", 0o600);
    fs.writeFileSync(lockDescriptor, lockMarker);
    const oldTimestamp = new Date(Date.now() - 5_000);
    fs.futimesSync(lockDescriptor, oldTimestamp, oldTimestamp);
    const lockInode = fs.fstatSync(lockDescriptor).ino;
    const moduleUrl = new URL("../src/lib/config.ts", import.meta.url).href;
    const preload = path.resolve(import.meta.dirname, "fixtures/no-hard-link.cjs");
    const program = [
      `import { loadConfig } from ${JSON.stringify(moduleUrl)};`,
      `loadConfig({ DATA_DIR: ${JSON.stringify(dataDir)} })`,
      ".then((config) => process.stdout.write(config.jwtSecret))",
      ".catch((error) => { console.error(error); process.exit(1); });",
    ].join("");

    try {
      const results = await Promise.allSettled(Array.from({ length: 2 }, () => execFileAsync(
        process.execPath,
        ["--import", "tsx", "--input-type=module", "--eval", program],
        {
          cwd: path.resolve(import.meta.dirname, ".."),
          env: { ...process.env, NODE_OPTIONS: `--require ${preload}` },
        },
      )));

      expect(results.map((result) => result.status)).toEqual(["rejected", "rejected"]);
      for (const result of results) {
        if (result.status !== "rejected") continue;
        expect(String((result.reason as { stderr?: string }).stderr ?? result.reason))
          .toContain(`JWT publication lock at ${lockPath} did not become available`);
      }
      expect(fs.statSync(lockPath).ino).toBe(lockInode);
      expect(fs.readFileSync(lockPath, "utf8")).toBe(lockMarker);
      expect(fs.existsSync(jwtKeyPath)).toBe(false);
      expect(fs.readdirSync(dataDir).filter((name) => name.includes("jwt.key") && name.endsWith(".tmp"))).toEqual([]);
    } finally {
      fs.closeSync(lockDescriptor);
      fs.rmSync(lockPath, { force: true });
    }
  });
});

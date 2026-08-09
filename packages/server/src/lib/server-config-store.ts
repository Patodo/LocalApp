import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { loadConfig, type PersistedServerSettings, type ServerConfig } from "./config.js";

export interface ServerConfigStore {
  read(): Promise<ServerConfig>;
  validate(candidate: ServerConfig): Promise<ServerConfig>;
  write(candidate: ServerConfig): Promise<void>;
}

export interface CreateServerConfigStoreOptions {
  env?: NodeJS.ProcessEnv;
}

export function createServerConfigStore(options: CreateServerConfigStoreOptions = {}): ServerConfigStore {
  const env = options.env ?? process.env;

  return {
    read: () => loadConfig(env),
    async validate(candidate) {
      if (!candidate.listenHost.trim()) throw new Error("listenHost is required");
      if (!Number.isSafeInteger(candidate.listenPort) || candidate.listenPort < 0 || candidate.listenPort > 65_535) {
        throw new Error("listenPort must be between 0 and 65535");
      }
      if (candidate.listenHost !== "127.0.0.1" && candidate.listenHost !== "::1" && !candidate.allowInsecureLan) {
        throw new Error("allowInsecureLan must be true when binding outside loopback");
      }
      await assertListenerAvailable(candidate.listenHost, candidate.listenPort);
      return {
        ...candidate,
        workspaceDir: path.resolve(candidate.dataDir, candidate.workspaceDir),
      };
    },
    async write(candidate) {
      const settings: PersistedServerSettings = {
        listenHost: candidate.listenHost,
        listenPort: candidate.listenPort,
        publicUrl: candidate.publicUrl,
        workspaceDir: candidate.workspaceDir,
        allowInsecureLan: candidate.allowInsecureLan,
      };
      await fs.mkdir(candidate.dataDir, { recursive: true, mode: 0o700 });
      const settingsPath = path.join(candidate.dataDir, "server.json");
      await fs.writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
      if (process.platform !== "win32") await fs.chmod(settingsPath, 0o600);
    },
  };
}

async function assertListenerAvailable(host: string, port: number): Promise<void> {
  const listener = net.createServer();
  await new Promise<void>((resolve, reject) => {
    listener.once("error", reject);
    listener.listen({ host, port }, () => {
      listener.off("error", reject);
      resolve();
    });
  });
  await new Promise<void>((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
}

import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { isLoopbackAddress } from "./loopback.js";
import {
  loadConfig,
  readPendingNetworkSettings,
  readPersistedServerSettings,
  type PendingNetworkSettings,
  type PersistedServerSettings,
  type ServerConfig,
} from "./config.js";

export interface ServerConfigStore {
  read(): Promise<ServerConfig>;
  validate(candidate: ServerConfig): Promise<ServerConfig>;
  write(candidate: ServerConfig): Promise<void>;
  hasPendingNetworkChange(): Promise<boolean>;
  stageNetworkChange(candidate: ServerConfig): Promise<void>;
  finalizePendingNetworkChange(): Promise<void>;
  rollbackPendingNetworkChange(): Promise<void>;
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
      if (!isLoopbackAddress(candidate.listenHost) && !candidate.allowInsecureLan) {
        throw new Error("allowInsecureLan must be true when binding outside loopback");
      }
      await assertListenerAvailable(candidate.listenHost, candidate.listenPort);
      return {
        ...candidate,
        workspaceDir: path.resolve(candidate.dataDir, candidate.workspaceDir),
      };
    },
    async write(candidate) {
      await writeSettings(candidate.dataDir, settingsFromConfig(candidate));
    },
    async hasPendingNetworkChange() {
      return readPendingNetworkSettings((await loadConfig(env)).dataDir) !== undefined;
    },
    async stageNetworkChange(candidate) {
      const dataDir = candidate.dataDir;
      const pending: PendingNetworkSettings = {
        previous: asCompleteSettings(readPersistedServerSettings(dataDir)),
        candidate: settingsFromConfig(candidate),
      };
      await writeJsonAtomically(path.join(dataDir, "server.pending.json"), pending);
    },
    async finalizePendingNetworkChange() {
      const dataDir = (await loadConfig(env)).dataDir;
      const pending = readPendingNetworkSettings(dataDir);
      if (!pending) return;
      await writeSettings(dataDir, pending.candidate);
      await fs.rm(path.join(dataDir, "server.pending.json"), { force: true });
      await syncDirectory(dataDir);
    },
    async rollbackPendingNetworkChange() {
      const dataDir = (await loadConfig(env)).dataDir;
      const pending = readPendingNetworkSettings(dataDir);
      if (!pending) return;
      if (pending.previous) await writeSettings(dataDir, pending.previous);
      else await fs.rm(path.join(dataDir, "server.json"), { force: true });
      await fs.rm(path.join(dataDir, "server.pending.json"), { force: true });
      await syncDirectory(dataDir);
    },
  };
}

function settingsFromConfig(candidate: ServerConfig): PersistedServerSettings {
  return {
    listenHost: candidate.listenHost,
    listenPort: candidate.listenPort,
    publicUrl: candidate.publicUrl,
    workspaceDir: candidate.workspaceDir,
    allowInsecureLan: candidate.allowInsecureLan,
  };
}

function asCompleteSettings(settings: Partial<PersistedServerSettings>): PersistedServerSettings | null {
  return Object.keys(settings).length === 5 ? settings as PersistedServerSettings : null;
}

async function writeSettings(dataDir: string, settings: PersistedServerSettings): Promise<void> {
  await writeJsonAtomically(path.join(dataDir, "server.json"), settings);
}

async function writeJsonAtomically(filePath: string, value: unknown): Promise<void> {
  const directory = path.dirname(filePath);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const temporaryPath = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`);
  const handle = await fs.open(temporaryPath, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`);
    if (process.platform !== "win32") await handle.chmod(0o600);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true });
    throw error;
  }
  await syncDirectory(directory);
}

async function syncDirectory(directory: string): Promise<void> {
  try {
    const handle = await fs.open(directory, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error: unknown) {
    const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
    if (!["EINVAL", "EPERM", "EISDIR"].includes(code ?? "")) throw error;
  }
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

import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { createServerConfigStore } from "./lib/server-config-store.js";
import type { WorkerMessage } from "./worker.js";
import { closeMetaDb, initMetaDb, listUsers } from "./lib/meta-sqlite.js";

interface StartOptions {
  dataDir?: string;
  host?: string;
  port?: number;
}

function parseStartOptions(args: string[]): StartOptions {
  if (args[0] !== "start") throw new Error("Internal Server usage: start [--data-dir <dir>] [--host <host>] [--port <port>]");
  const options: StartOptions = {};
  for (let index = 1; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!value || !["--data-dir", "--host", "--port"].includes(flag)) {
      throw new Error("Internal Server usage: start [--data-dir <dir>] [--host <host>] [--port <port>]");
    }
    if (flag === "--data-dir") options.dataDir = value;
    if (flag === "--host") options.host = value;
    if (flag === "--port") options.port = Number(value);
  }
  if (options.port !== undefined && (!Number.isSafeInteger(options.port) || options.port < 0 || options.port > 65_535)) {
    throw new Error("--port must be between 0 and 65535");
  }
  return options;
}

export async function runCli(args = process.argv.slice(2)): Promise<void> {
  const options = parseStartOptions(args);
  const env = { ...process.env, ...(options.dataDir ? { DATA_DIR: options.dataDir } : {}) };
  const configStore = createServerConfigStore({ env });
  const config = await configStore.read();
  const setupRequired = await requiresSetup(config.dataDir);
  if (options.host !== undefined || options.port !== undefined) {
    await configStore.write(await configStore.validate({
      ...config,
      listenHost: setupRequired ? "127.0.0.1" : (options.host ?? config.listenHost),
      listenPort: options.port ?? config.listenPort,
      publicUrl: setupRequired ? "" : config.publicUrl,
      allowInsecureLan: setupRequired ? false : config.allowInsecureLan,
    }));
  }

  let stopping = false;
  let child: ChildProcess;
  const spawnWorker = (usePendingConfig: boolean) => {
    const workerEnv: NodeJS.ProcessEnv = { ...env };
    delete workerEnv.LOCALAPP_USE_PENDING_CONFIG;
    if (usePendingConfig) workerEnv.LOCALAPP_USE_PENDING_CONFIG = "1";
    const workerPath = process.env.LOCALAPP_WORKER_PATH ?? path.join(__dirname, "worker.js");
    return spawn(process.execPath, [workerPath], {
      env: workerEnv,
      stdio: ["inherit", "inherit", "inherit", "ipc"],
    });
  };
  const attachWorker = async (pendingConfig?: boolean) => {
    const usePendingConfig = pendingConfig ?? await configStore.hasPendingNetworkChange();
    child = spawnWorker(usePendingConfig);
    let ready = false;
    child.on("message", async (message: WorkerMessage) => {
      if (message.type === "starting") {
        process.stdout.write(`${JSON.stringify(message)}\n`);
        return;
      }
      if (message.type !== "ready") return;
      try {
        if (usePendingConfig) await configStore.finalizePendingNetworkChange();
        ready = true;
        process.stdout.write(`${JSON.stringify(message)}\n`);
      } catch (error) {
        console.error(error);
        child.kill("SIGTERM");
      }
    });
    child.once("exit", async (code) => {
      if (stopping) {
        process.exit(code ?? 1);
        return;
      }
      if (usePendingConfig && !ready) {
        try {
          await configStore.rollbackPendingNetworkChange();
          process.stderr.write("candidate worker exited before readiness; rolling back\n");
          await attachWorker(false);
        } catch (error) {
          console.error(error);
          process.exit(1);
        }
        return;
      }
      if (code === 75) {
        await attachWorker();
        return;
      }
      process.exit(code ?? 1);
    });
  };
  const stop = (signal: NodeJS.Signals) => {
    stopping = true;
    child.kill(signal);
  };
  process.once("SIGINT", () => stop("SIGINT"));
  process.once("SIGTERM", () => stop("SIGTERM"));
  await attachWorker();
}

async function requiresSetup(dataDir: string): Promise<boolean> {
  await initMetaDb(dataDir);
  try {
    return listUsers(1, 1).total === 0;
  } finally {
    closeMetaDb();
  }
}

if (typeof require !== "undefined" && require.main === module && process.env.LOCALAPP_PACKAGE_ENTRY !== "1") {
  runCli().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

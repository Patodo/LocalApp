import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { createServerConfigStore } from "./lib/server-config-store.js";
import type { WorkerReadyMessage } from "./worker.js";

interface StartOptions {
  dataDir?: string;
  host?: string;
  port?: number;
}

function parseStartOptions(args: string[]): StartOptions {
  if (args[0] !== "start") throw new Error("Usage: localapp-server start [--data-dir <dir>] [--host <host>] [--port <port>]");
  const options: StartOptions = {};
  for (let index = 1; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!value || !["--data-dir", "--host", "--port"].includes(flag)) {
      throw new Error("Usage: localapp-server start [--data-dir <dir>] [--host <host>] [--port <port>]");
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
  if (options.host !== undefined || options.port !== undefined) {
    await configStore.write(await configStore.validate({
      ...config,
      listenHost: options.host ?? config.listenHost,
      listenPort: options.port ?? config.listenPort,
    }));
  }

  let stopping = false;
  let child: ChildProcess;
  const spawnWorker = () => spawn(process.execPath, [path.join(__dirname, "worker.js")], {
    env,
    stdio: ["inherit", "inherit", "inherit", "ipc"],
  });
  const attachWorker = () => {
    child = spawnWorker();
    child.on("message", (message: WorkerReadyMessage) => {
      if (message.type === "ready") process.stdout.write(`${JSON.stringify(message)}\n`);
    });
    child.once("exit", (code) => {
      if (code === 75 && !stopping) {
        attachWorker();
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
  attachWorker();
}

if (require.main === module) {
  runCli().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

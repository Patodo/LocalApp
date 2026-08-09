import { buildServer } from "./server.js";
import { SetupTokenStore } from "./lib/setup-token-store.js";
import { listUsers } from "./lib/meta-sqlite.js";

export interface WorkerReadyMessage {
  type: "ready";
  url: string;
  setupUrl?: string;
  workerPid: number;
}

export async function runWorker(): Promise<void> {
  let app: Awaited<ReturnType<typeof buildServer>> | undefined;
  const setupTokens = new SetupTokenStore();
  app = await buildServer({
    setupTokens,
    restartController: {
      requestRestart(exitCode) {
        void app?.close().finally(() => process.exit(exitCode));
      },
    },
  });
  const setupRequired = listUsers(1, 1).total === 0;
  const listenHost = setupRequired ? "127.0.0.1" : app.config.listenHost;
  await app.listen({ host: listenHost, port: app.config.listenPort });
  const address = app.addresses()[0];
  if (!address || typeof address === "string") throw new Error("Expected TCP listener");
  const url = setupRequired ? `http://127.0.0.1:${address.port}` : (app.config.publicUrl || `http://${listenHost}:${address.port}`);
  const message: WorkerReadyMessage = { type: "ready", url, workerPid: process.pid };
  if (setupRequired) {
    const issued = setupTokens.issue();
    message.setupUrl = `${url}/setup?token=${encodeURIComponent(issued.token)}`;
  }
  if (process.send) process.send(message);
  else process.stdout.write(`${JSON.stringify(message)}\n`);

  const close = () => void app?.close().finally(() => process.exit(0));
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
}

if (require.main === module) {
  runWorker().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

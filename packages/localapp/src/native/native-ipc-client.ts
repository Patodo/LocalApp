import { forwardActivationToDaemon } from "../activation/activation-broker.js";
import { createIpcClient } from "../daemon/ipc-client.js";
import { createRuntimeLayout } from "../daemon/runtime-layout.js";
import { createCurrentUserServiceManager } from "../service/service-manager.js";

async function main(argv: string[]): Promise<void> {
  if (argv.length !== 1) { process.exitCode = 1; return; }
  const url = argv[0]!;
  const layout = createRuntimeLayout({
    supportDir: process.env.LOCALAPP_SUPPORT_DIR,
    runtimeDir: process.env.LOCALAPP_RUNTIME_DIR,
    dataDir: process.env.LOCALAPP_DATA_DIR,
  });
  await forwardActivationToDaemon({
    url,
    ipcClient: createIpcClient({ endpoint: layout.controlEndpoint, timeoutMs: 1_000 }),
    service: createCurrentUserServiceManager(layout),
  });
}

void main(process.argv.slice(2)).catch(() => { process.exitCode = 1; });

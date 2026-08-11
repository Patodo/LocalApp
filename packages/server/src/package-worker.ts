import { runWorker } from "./worker.js";

void runWorker().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

export { buildServer } from "./server.js";
export * from "./app-package-api.js";
import { runCli } from "./cli.js";

if (require.main === module) {
  runCli(["start", ...process.argv.slice(2)]).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

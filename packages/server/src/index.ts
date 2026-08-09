import { buildServer } from "./server.js";

async function main() {
  const app = await buildServer();
  await app.listen({ port: app.config.port, host: "0.0.0.0" });
  console.log(`LocalApp server listening on port ${app.config.port}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

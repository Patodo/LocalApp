import { buildServer } from "./server.js";

async function main() {
  const app = await buildServer();
  await app.listen({ port: app.config.listenPort, host: app.config.listenHost });
  console.log(`LocalApp server listening on ${app.config.listenHost}:${app.config.listenPort}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { LocalAppClient } from "../src/http/localapp-client.js";
import { runLocalApp } from "../src/main.js";
import { loadPackageVersion } from "../src/version.js";

const servers: Server[] = [];
const directories: string[] = [];

async function listen(server: Server): Promise<string> {
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Test server did not bind a TCP port");
  return `http://127.0.0.1:${address.port}`;
}

async function createDirectory(): Promise<string> {
  const testRoot = path.resolve(process.cwd(), "../../tmp/localapp-task-2-tests");
  await mkdir(testRoot, { recursive: true });
  const directory = await mkdtemp(path.join(testRoot, "version-"));
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)))));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

it("loads a package version from its manifest", async () => {
  // Break caught: embedding a version literal ignores ordinary package-manifest bumps.
  const manifest = path.join(await createDirectory(), "package.json");
  await writeFile(manifest, '{"name":"localapp","version":"7.8.9"}\n');

  await expect(loadPackageVersion(manifest)).resolves.toBe("7.8.9");
});

it("uses the current package manifest version for CLI and authenticated HTTP", async () => {
  // Break caught: the --version result or request header diverges from the package being executed.
  const manifest = JSON.parse(await readFile(path.resolve(process.cwd(), "package.json"), "utf8")) as { version: string };
  const serverUrl = await listen(createServer((request, response) => {
    expect(request.headers["x-cli-version"]).toBe(manifest.version);
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"success":true}');
  }));
  let stdout = "";

  const code = await runLocalApp(["--version"], { stdout: (value) => { stdout += value; }, stderr: () => undefined });
  await new LocalAppClient({ name: "local", serverUrl, apiKey: "version-test-key" }).getJson("/api/me");

  expect(code).toBe(0);
  expect(stdout).toBe(`localapp ${manifest.version}\n`);
});

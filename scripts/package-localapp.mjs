import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageDirectory = path.join(repositoryRoot, "packages/localapp");
const outputDirectory = path.join(repositoryRoot, "tmp/localapp-package");
const manifest = JSON.parse(await fs.readFile(path.join(packageDirectory, "package.json"), "utf8"));
const expectedName = `localapp-${manifest.version}.tgz`;

await fs.rm(outputDirectory, { recursive: true, force: true });
await fs.mkdir(outputDirectory, { recursive: true, mode: 0o755 });
await run("pnpm", ["pack", "--pack-destination", outputDirectory], packageDirectory);

const entries = await fs.readdir(outputDirectory);
if (entries.length !== 1 || entries[0] !== expectedName) {
  throw new Error(`LocalApp packaging produced unexpected artifacts: ${entries.join(", ")}`);
}
process.stdout.write(`${path.join(outputDirectory, expectedName)}\n`);

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, shell: false, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)));
  });
}

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLocalAppPackage } from "./build-package.mjs";

const packageDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stagingDirectory = path.join(packageDirectory, ".localapp-pack");

await fs.rm(path.join(packageDirectory, "bin"), { recursive: true, force: true });
await fs.rm(path.join(packageDirectory, ".localapp-artifact.json"), { force: true });
const artifact = await buildLocalAppPackage({ outputDirectory: stagingDirectory });
await fs.cp(path.join(artifact.outputDirectory, "bin"), path.join(packageDirectory, "bin"), { recursive: true });
await fs.copyFile(artifact.manifestPath, path.join(packageDirectory, ".localapp-artifact.json"));

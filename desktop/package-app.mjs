import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stageNodeRuntime } from "./package-node.mjs";
import { packager } from "@electron/packager";

const here = path.dirname(fileURLToPath(import.meta.url));
const temp = path.resolve(here, "../tmp");
const args = process.argv.slice(2);
if (args.length && (args.length !== 1 || args[0] !== "--windows")) throw new Error("Usage: npm run package -- [--windows]");
const target = args.length ? { platform: "win32", arch: "x64" } : {};
const manifest = JSON.parse(await readFile(path.join(here, "package.json"), "utf8"));
await mkdir(temp, { recursive: true });
const staging = await mkdtemp(path.join(temp, "localapp-desktop-stage-"));
try {
  for (const file of ["main.mjs", "device-activation.mjs", "shadow.mjs", "shortcuts.mjs"]) {
    await cp(path.join(here, file), path.join(staging, file));
  }
  await writeFile(path.join(staging, "package.json"), JSON.stringify({
    name: manifest.name, version: manifest.version, type: manifest.type, main: manifest.main,
  }));
  const dependency = "node_modules/@patodo/localapp";
  await mkdir(path.dirname(path.join(staging, dependency)), { recursive: true });
  const runtimeDirectory = process.env.LOCALAPP_DESKTOP_RUNTIME_DIRECTORY
    ? path.resolve(process.env.LOCALAPP_DESKTOP_RUNTIME_DIRECTORY)
    : path.join(here, dependency);
  const runtime = JSON.parse(await readFile(path.join(runtimeDirectory, "package.json"), "utf8"));
  if (runtime.name !== "@patodo/localapp") throw new Error("Expected a built @patodo/localapp runtime");
  await cp(runtimeDirectory, path.join(staging, dependency), { recursive: true });
  await stageNodeRuntime(staging, path.join(temp, "desktop-node-cache"), target.platform ?? process.platform, target.arch ?? process.arch);
  const paths = await packager({
    dir: staging,
    out: process.env.LOCALAPP_DESKTOP_OUTPUT_DIRECTORY
      ? path.resolve(process.env.LOCALAPP_DESKTOP_OUTPUT_DIRECTORY)
      : path.join(temp, "localapp-desktop-dist"),
    name: "LocalApp",
    appBundleId: "dev.localapp.desktop",
    protocols: [{ name: "LocalApp Device Action", schemes: ["localapp"] }],
    ...target,
    electronVersion: manifest.devDependencies.electron,
    asar: false,
    prune: false,
    overwrite: true,
  });
  for (const output of paths) {
    if (process.platform === "darwin" && !args.length) {
      // Sign the outer app only. LocalApp verifies the bytes of its embedded npm runtime.
      const bundle = path.join(output, "LocalApp.app");
      const run = promisify(execFile);
      await run("/usr/bin/codesign", ["--force", "--sign", "-", "--timestamp=none", bundle]);
      await run("/usr/bin/codesign", ["--verify", "--strict", bundle]);
    }
    console.log(output);
  }
} finally {
  await rm(staging, { recursive: true, force: true });
}

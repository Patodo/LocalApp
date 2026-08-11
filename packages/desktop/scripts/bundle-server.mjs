import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP_DIRECTORY = path.resolve(SCRIPT_DIRECTORY, "..");
const PROJECT_DIRECTORY = path.resolve(DESKTOP_DIRECTORY, "../..");
const OUTPUT_DIRECTORY = path.join(DESKTOP_DIRECTORY, "src-tauri/resources/server");

export async function bundleServer({ outputDirectory = OUTPUT_DIRECTORY, runPackage = runServerPackage } = {}) {
  await runPackage(outputDirectory);
  const manifestPath = path.join(outputDirectory, ".localapp-server-artifact.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  if (manifest.name !== "@localapp/server" || manifest.entrypoint !== "bin/localapp-server.mjs") {
    throw new Error("Server bundle manifest is not a canonical LocalApp Server artifact");
  }
  return { outputDirectory, manifestPath, bundleDigest: manifest.bundleDigest };
}

function runServerPackage(outputDirectory) {
  const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  return new Promise((resolve, reject) => {
    execFile(pnpm, ["-C", path.join(PROJECT_DIRECTORY, "packages/server"), "package"], {
      env: { ...process.env, LOCALAPP_SERVER_PACKAGE_DIR: outputDirectory },
      windowsHide: true,
    }, (error, _stdout, stderr) => {
      if (error) {
        reject(new Error(`Server package build failed: ${stderr || error.message}`));
        return;
      }
      resolve();
    });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  bundleServer()
    .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}

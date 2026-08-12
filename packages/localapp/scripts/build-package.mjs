import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const packageDirectory = path.resolve(scriptDirectory, "..");
const projectDirectory = path.resolve(packageDirectory, "../..");
const defaultOutputDirectory = path.join(projectDirectory, "tmp/localapp-package");

/**
 * Builds the self-contained public localapp npm package directory.
 * @param {{ outputDirectory?: string }} [options]
 */
export async function buildLocalAppPackage(options = {}) {
  const outputDirectory = path.resolve(options.outputDirectory ?? process.env.LOCALAPP_PACKAGE_DIR ?? defaultOutputDirectory);
  const binDirectory = path.join(outputDirectory, "bin");
  const sourceManifest = JSON.parse(await fs.readFile(path.join(packageDirectory, "package.json"), "utf8"));

  await fs.rm(outputDirectory, { recursive: true, force: true });
  await fs.mkdir(binDirectory, { recursive: true, mode: 0o755 });
  await build({
    absWorkingDir: projectDirectory,
    bundle: true,
    entryPoints: [path.join(packageDirectory, "src/main.ts")],
    format: "esm",
    legalComments: "none",
    outfile: path.join(binDirectory, "localapp.mjs"),
    platform: "node",
    sourcemap: false,
    target: "node24",
    banner: { js: "#!/usr/bin/env node" },
  });
  await fs.chmod(path.join(binDirectory, "localapp.mjs"), 0o755);

  const packageJson = {
    name: "localapp",
    version: sourceManifest.version,
    description: sourceManifest.description,
    license: sourceManifest.license,
    type: "module",
    bin: { localapp: "bin/localapp.mjs" },
    engines: { node: ">=24" },
  };
  const manifestPath = path.join(outputDirectory, ".localapp-artifact.json");
  await writeJson(path.join(outputDirectory, "package.json"), packageJson);
  await writeJson(manifestPath, {
    schemaVersion: 1,
    name: packageJson.name,
    version: packageJson.version,
    nodeMajor: 24,
    entrypoint: "bin/localapp.mjs",
    bundleDigest: await sha256(path.join(binDirectory, "localapp.mjs")),
  });

  return { outputDirectory, tarballInput: outputDirectory, manifestPath };
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

async function sha256(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(await fs.readFile(filePath));
  return hash.digest("hex");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  buildLocalAppPackage().then((result) => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

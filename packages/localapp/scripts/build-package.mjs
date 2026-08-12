import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const packageDirectory = path.resolve(scriptDirectory, "..");
const projectDirectory = path.resolve(process.env.LOCALAPP_REPOSITORY_ROOT ?? path.resolve(packageDirectory, "../.."));
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
  await stageBuiltinTemplate({ outputDirectory, version: sourceManifest.version });
  const { buildServerPackage } = await import(pathToFileURL(path.join(projectDirectory, "packages/server/scripts/build-server-package.mjs")).href);
  const serverArtifact = await buildServerPackage({ outputDirectory: path.join(outputDirectory, "runtime/server") });
  await build({
    absWorkingDir: projectDirectory,
    alias: {
      "@localapp/server/app-package-api": path.join(projectDirectory, "packages/server/src/app-package-api.ts"),
      "@localapp/server-core": path.join(projectDirectory, "packages/server-core/src/index.ts"),
    },
    bundle: true,
    entryPoints: [path.join(packageDirectory, "src/main.ts")],
    format: "esm",
    legalComments: "none",
    outfile: path.join(binDirectory, "localapp.mjs"),
    platform: "node",
    sourcemap: false,
    target: "node24",
    banner: {
      js: "#!/usr/bin/env node\nimport { createRequire as __localAppCreateRequire } from 'node:module';\nconst require = __localAppCreateRequire(import.meta.url);",
    },
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
    serverBundleDigest: serverArtifact.bundleDigest,
    serverEntrypoint: "runtime/server/bin/localapp-server.mjs",
  });

  return { outputDirectory, tarballInput: outputDirectory, manifestPath };
}

async function stageBuiltinTemplate({ outputDirectory, version }) {
  const stagingEntrypoint = path.join(outputDirectory, ".stage-template.mjs");
  await build({
    absWorkingDir: projectDirectory,
    bundle: true,
    entryPoints: [path.join(packageDirectory, "src/template/stage.ts")],
    format: "esm",
    legalComments: "none",
    outfile: stagingEntrypoint,
    platform: "node",
    sourcemap: false,
    target: "node24",
  });
  try {
    const { stageBuiltinTemplate: stage } = await import(pathToFileURL(stagingEntrypoint).href);
    await stage({ repositoryRoot: projectDirectory, outputDirectory: path.join(outputDirectory, "template"), version });
  } finally {
    await fs.rm(stagingEntrypoint, { force: true });
  }
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

async function sha256(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(await fs.readFile(filePath));
  return hash.digest("hex");
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  buildLocalAppPackage().then((result) => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

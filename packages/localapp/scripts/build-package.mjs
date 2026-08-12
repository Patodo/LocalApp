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
  const bootstrapEntrypoint = "runtime/bootstrap/localapp-daemon-bootstrap.mjs";
  const bootstrapPath = path.join(outputDirectory, bootstrapEntrypoint);
  await fs.mkdir(path.dirname(bootstrapPath), { recursive: true, mode: 0o755 });
  await fs.writeFile(bootstrapPath, DAEMON_BOOTSTRAP_SOURCE, { mode: 0o755 });
  await fs.chmod(bootstrapPath, 0o755);
  const manifestPath = path.join(outputDirectory, ".localapp-artifact.json");
  await writeJson(path.join(outputDirectory, "package.json"), packageJson);
  const files = await collectArtifactFiles(outputDirectory);
  const artifactDescriptor = {
    schemaVersion: 2,
    name: packageJson.name,
    version: packageJson.version,
    nodeMajor: 24,
    entrypoint: "bin/localapp.mjs",
    bootstrapEntrypoint,
    files,
    bundleDigest: await sha256(path.join(binDirectory, "localapp.mjs")),
    serverBundleDigest: serverArtifact.bundleDigest,
    serverEntrypoint: "runtime/server/bin/localapp-server.mjs",
  };
  await writeJson(manifestPath, {
    ...artifactDescriptor,
    artifactDigest: sha256Bytes(Buffer.from(JSON.stringify(artifactDescriptor))),
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

function sha256Bytes(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

async function collectArtifactFiles(root) {
  const files = [];
  const visit = async (directory, prefix) => {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (relativePath === ".localapp-artifact.json") continue;
      const absolutePath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`symbolic link is not allowed in LocalApp artifact: ${relativePath}`);
      if (entry.isDirectory()) {
        await visit(absolutePath, relativePath);
        continue;
      }
      if (!entry.isFile()) throw new Error(`unsupported LocalApp artifact entry: ${relativePath}`);
      const before = await fs.lstat(absolutePath, { bigint: true });
      const bytes = await fs.readFile(absolutePath);
      const after = await fs.lstat(absolutePath, { bigint: true });
      if (!before.isFile() || before.isSymbolicLink() || !after.isFile() || after.isSymbolicLink()
        || before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
        || BigInt(bytes.byteLength) !== after.size) {
        throw new Error(`LocalApp artifact entry changed while hashing: ${relativePath}`);
      }
      files.push({ path: relativePath, size: bytes.byteLength, sha256: sha256Bytes(bytes) });
    }
  };
  await visit(root, "");
  files.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  return files;
}

const DAEMON_BOOTSTRAP_SOURCE = String.raw`#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const launcher = fileURLToPath(import.meta.url);
const support = path.resolve(path.dirname(launcher), "..");
const currentPath = path.join(support, "current.json");
const fail = () => { process.stderr.write("LocalApp current release is unavailable. Run localapp server start again.\n"); process.exit(1); };
let current;
try { current = JSON.parse(fs.readFileSync(currentPath, "utf8")); } catch { fail(); }
const digest = typeof current?.artifactDigest === "string" && /^[0-9a-f]{64}$/.test(current.artifactDigest) ? current.artifactDigest : "";
const version = typeof current?.version === "string" && /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,127}$/.test(current.version) ? current.version : "";
const expectedRelease = path.join(support, "releases", version + "-" + digest);
const entrypoint = typeof current?.entrypoint === "string" ? current.entrypoint : "";
if (!version || !digest || path.resolve(current.releasePath ?? "") !== path.resolve(expectedRelease)
  || !entrypoint || entrypoint.includes("\\") || path.posix.normalize(entrypoint) !== entrypoint
  || entrypoint.startsWith("/") || entrypoint.split("/").some((part) => !part || part === "." || part === "..")) fail();
const executable = path.join(expectedRelease, ...entrypoint.split("/"));
const child = spawn(process.execPath, [executable, "_daemon"], {
  cwd: expectedRelease,
  env: { ...process.env, LOCALAPP_RELEASE_PATH: expectedRelease },
  stdio: "inherit",
  shell: false,
  windowsHide: true,
});
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => child.kill(signal));
child.once("error", fail);
child.once("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
`;

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  buildLocalAppPackage().then((result) => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

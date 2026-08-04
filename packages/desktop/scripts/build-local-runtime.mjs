import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP_DIRECTORY = path.resolve(SCRIPT_DIRECTORY, "..");
const REPOSITORY_DIRECTORY = path.resolve(DESKTOP_DIRECTORY, "../..");
const DEFAULT_OUTPUT_DIRECTORY = path.join(
  DESKTOP_DIRECTORY,
  "src-tauri",
  "resources",
  "local-runtime",
);

export async function buildLocalRuntime({
  outputDirectory = DEFAULT_OUTPUT_DIRECTORY,
} = {}) {
  const entry = path.join(REPOSITORY_DIRECTORY, "packages", "local-runtime", "src", "cli.ts");
  const script = path.join(outputDirectory, "localapp-local-runtime.mjs");
  const sqlTarget = path.join(outputDirectory, "node_modules", "sql.js");
  await rm(outputDirectory, { force: true, recursive: true });
  await mkdir(outputDirectory, { recursive: true });
  await build({
    entryPoints: [entry],
    outfile: script,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node24",
    packages: "bundle",
    external: ["sql.js"],
    banner: {
      js: 'import { createRequire as __localappCreateRequire } from "node:module"; const require = __localappCreateRequire(import.meta.url);',
    },
    sourcemap: false,
    legalComments: "none",
  });

  const requireFromServerCore = createRequire(
    path.join(REPOSITORY_DIRECTORY, "packages", "server-core", "package.json"),
  );
  const sqlEntry = requireFromServerCore.resolve("sql.js");
  const sqlRoot = await findPackageRoot(path.dirname(sqlEntry), "sql.js");
  await mkdir(path.dirname(sqlTarget), { recursive: true });
  await cp(sqlRoot, sqlTarget, { recursive: true });
  await writeFile(
    path.join(outputDirectory, ".localapp-local-runtime.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      entry: "localapp-local-runtime.mjs",
      sqlJs: JSON.parse(await readFile(path.join(sqlRoot, "package.json"), "utf8")).version,
    }, null, 2)}\n`,
  );
  return { outputDirectory, script, sqlTarget };
}

async function findPackageRoot(directory, packageName) {
  let current = directory;
  for (;;) {
    try {
      const manifest = JSON.parse(await readFile(path.join(current, "package.json"), "utf8"));
      if (manifest.name === packageName) return current;
    } catch {}
    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error(`Could not locate ${packageName} package root`);
    }
    current = parent;
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  buildLocalRuntime().catch((error) => {
    console.error(error instanceof Error ? error.message : "Local Runtime build failed");
    process.exitCode = 1;
  });
}

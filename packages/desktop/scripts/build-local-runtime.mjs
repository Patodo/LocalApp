import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
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

  // ── 把 PlatformShell 静态产物(Next.js export)带进 local-runtime ──
  // Local Runtime 复用远程 server 同一份 PlatformShell,本地应用导航栏与远程一致。
  const webOutDir = path.join(REPOSITORY_DIRECTORY, "packages", "web", "out");
  let platformShellVersion = null;
  const platformShellHtml = path.join(
    webOutDir,
    "platform-shell",
    "placeholder",
    "placeholder.html",
  );
  let hasPlatformShell = false;
  try {
    await readFile(platformShellHtml, "utf8");
    hasPlatformShell = true;
  } catch {}
  if (!hasPlatformShell) {
    // 自动构建 web(产出 out/_next + out/platform-shell)
    const result = spawnSync("pnpm", ["--filter", "web", "build"], {
      stdio: "inherit",
      cwd: REPOSITORY_DIRECTORY,
    });
    if (result.status !== 0) {
      throw new Error(
        "Failed to build web package for PlatformShell. Run `pnpm --filter web build` manually to diagnose.",
      );
    }
  }
  // 拷贝 _next/(chunks/css/media)和 platform-shell/(placeholder.html)
  const nextSrc = path.join(webOutDir, "_next");
  const nextDst = path.join(outputDirectory, "_next");
  await rm(nextDst, { force: true, recursive: true });
  await cp(nextSrc, nextDst, { recursive: true });

  const shellSrc = path.join(webOutDir, "platform-shell");
  const shellDst = path.join(outputDirectory, "platform-shell");
  await rm(shellDst, { force: true, recursive: true });
  await cp(shellSrc, shellDst, { recursive: true });

  const webManifest = JSON.parse(
    await readFile(path.join(REPOSITORY_DIRECTORY, "packages", "web", "package.json"), "utf8"),
  );
  platformShellVersion = webManifest.version;

  await writeFile(
    path.join(outputDirectory, ".localapp-local-runtime.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      entry: "localapp-local-runtime.mjs",
      sqlJs: JSON.parse(await readFile(path.join(sqlRoot, "package.json"), "utf8")).version,
      platformShell: platformShellVersion,
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

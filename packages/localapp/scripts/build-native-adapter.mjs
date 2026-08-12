import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const packageDirectory = path.resolve(scriptDirectory, "..");
const repositoryRoot = path.resolve(process.env.LOCALAPP_REPOSITORY_ROOT ?? path.resolve(packageDirectory, "../.."));

/** Builds the exact current-host adapter; cross-platform source is never packed. */
export async function buildNativeAdapter(options = {}) {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const target = `${platform}-${arch}`;
  const outputDirectory = path.resolve(options.outputDirectory ?? path.join(repositoryRoot, "tmp/localapp-native"));
  const signing = options.signing ?? process.env.LOCALAPP_NATIVE_SIGNING ?? "adhoc";
  if (signing !== "adhoc" && signing !== "release") throw new Error("LOCALAPP_NATIVE_SIGNING must be adhoc or release");
  if (platform !== "darwin" || !["arm64", "x64"].includes(arch)) {
    throw new Error(`NATIVE_ADAPTER_UNSUPPORTED: cannot build ${target} on this host`);
  }
  await fs.rm(outputDirectory, { recursive: true, force: true });
  await fs.mkdir(outputDirectory, { recursive: true, mode: 0o755 });
  const targetDirectory = path.join(outputDirectory, target);
  const appBundle = path.join(targetDirectory, "LocalAppBridge.app");
  const macos = path.join(appBundle, "Contents", "MacOS");
  const resources = path.join(appBundle, "Contents", "Resources");
  await fs.mkdir(macos, { recursive: true, mode: 0o755 });
  await fs.mkdir(resources, { recursive: true, mode: 0o755 });
  const bundleIdentifier = options.bundleIdentifier ?? "dev.localapp.bridge";
  if (!/^dev\.localapp\.bridge(?:\.[a-z0-9-]+)*$/.test(bundleIdentifier)) throw new Error("invalid native bundle identifier");
  const info = (await fs.readFile(path.join(packageDirectory, "native/macos/Info.plist"), "utf8"))
    .replaceAll("@BUNDLE_IDENTIFIER@", bundleIdentifier);
  await fs.writeFile(path.join(appBundle, "Contents", "Info.plist"), info, { mode: 0o644 });
  const executable = path.join(macos, "LocalAppBridge");
  await copyCachedBridge({ target, executable, cacheDirectory: options.cacheDirectory });
  await build({
    absWorkingDir: repositoryRoot,
    alias: { "@localapp/server/device-action-ticket": path.join(repositoryRoot, "packages/server/src/device-action-ticket.ts") },
    bundle: true,
    entryPoints: [path.join(packageDirectory, "src/native/native-ipc-client.ts")],
    format: "esm",
    legalComments: "none",
    outfile: path.join(resources, "localapp-native-ipc-client.mjs"),
    platform: "node",
    sourcemap: false,
    target: "node24",
    banner: { js: "#!/usr/bin/env node" },
  });
  await fs.chmod(path.join(resources, "localapp-native-ipc-client.mjs"), 0o755);
  if (typeof options.runtimeDir === "string") {
    await fs.writeFile(path.join(resources, "runtime-configuration.json"), `${JSON.stringify({ LOCALAPP_RUNTIME_DIR: path.resolve(options.runtimeDir) })}\n`, { mode: 0o600 });
  }
  const identity = signing === "release" ? process.env.LOCALAPP_MACOS_SIGNING_IDENTITY : "-";
  if (signing === "release" && (!identity || identity === "-")) {
    throw new Error("LOCALAPP_MACOS_SIGNING_IDENTITY is required for release signing");
  }
  await run("/usr/bin/codesign", ["--force", "--sign", identity, "--options", "runtime", appBundle]);
  const assets = await collectAssets(outputDirectory);
  await fs.writeFile(path.join(outputDirectory, "adapter-manifest.json"), `${JSON.stringify({
    schemaVersion: 1,
    target,
    signing: { mode: signing },
    assets,
  }, null, 2)}\n`, { mode: 0o644 });
  return { outputDirectory, target, appBundle, executable, signing: { mode: signing } };
}

async function copyCachedBridge({ target, executable, cacheDirectory }) {
  const source = path.join(packageDirectory, "native/macos/LocalAppBridge.swift");
  const key = crypto.createHash("sha256").update(await fs.readFile(source)).update(target).digest("hex");
  const cacheRoot = path.resolve(cacheDirectory ?? path.join(repositoryRoot, "tmp/localapp-native-build-cache"));
  const cached = path.join(cacheRoot, target, key, "LocalAppBridge");
  const present = await fs.access(cached).then(() => true, () => false);
  if (!present) {
    await fs.mkdir(path.dirname(cached), { recursive: true, mode: 0o700 });
    await run("/usr/bin/swiftc", [
      source,
      "-framework", "AppKit", "-framework", "CoreServices", "-framework", "UserNotifications",
      "-o", cached,
    ]);
  }
  await fs.copyFile(cached, executable);
  await fs.chmod(executable, 0o755);
}

async function collectAssets(root) {
  const files = [];
  const visit = async (directory, prefix) => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute, relative);
      else if (entry.isFile()) files.push({ path: relative, sha256: crypto.createHash("sha256").update(await fs.readFile(absolute)).digest("hex") });
      else throw new Error(`unsupported native adapter asset: ${relative}`);
    }
  };
  await visit(root, "");
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${path.basename(command)} failed: ${stderr.trim()}`)));
  });
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildNativeAdapter().then((result) => process.stdout.write(`${JSON.stringify(result)}\n`)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

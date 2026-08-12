import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { lifecycleError } from "../errors.js";

export interface NativeAdapterAsset { path: string; sha256: string; }
export interface SelectedNativeAdapter {
  target: string;
  root: string;
  executable: string;
  ipcClient: string;
  signing: { mode: "adhoc" | "release" };
  assets: NativeAdapterAsset[];
}

export interface SelectNativeAdapterOptions {
  root: string;
  platform?: NodeJS.Platform;
  arch?: string;
}

/**
 * Selects exactly one packaged adapter. A release may not fall back to a
 * similar architecture or to an ambient executable.
 */
export async function selectNativeAdapter(options: SelectNativeAdapterOptions): Promise<SelectedNativeAdapter> {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const target = targetFor(platform, arch);
  const root = path.resolve(options.root);
  let value: unknown;
  try { value = JSON.parse(await fs.readFile(path.join(root, "adapter-manifest.json"), "utf8")); }
  catch { throw unsupported(platform, arch); }
  const manifest = parseManifest(value, target, root, platform, arch);
  for (const asset of manifest.assets) {
    const absolute = path.join(root, ...asset.path.split("/"));
    let bytes: Buffer;
    try {
      const stat = await fs.lstat(absolute);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("unsafe native asset");
      bytes = await fs.readFile(absolute);
    } catch { throw lifecycleError("native_adapter_digest_invalid", "The selected LocalApp native adapter is missing or unsafe"); }
    if (crypto.createHash("sha256").update(bytes).digest("hex") !== asset.sha256) {
      throw lifecycleError("native_adapter_digest_invalid", "The selected LocalApp native adapter digest is invalid");
    }
  }
  const executable = executableFor(target);
  const ipcClient = ipcClientFor(target);
  if (!manifest.assets.some((asset) => asset.path === executable) || !manifest.assets.some((asset) => asset.path === ipcClient)) {
    throw lifecycleError("native_adapter_digest_invalid", "The selected LocalApp native adapter executable is missing");
  }
  return {
    target,
    root,
    executable: path.join(root, ...executable.split("/")),
    ipcClient: path.join(root, ...ipcClient.split("/")),
    signing: manifest.signing,
    assets: manifest.assets,
  };
}

export function nativeTargetFor(platform: NodeJS.Platform, arch: string): string {
  return targetFor(platform, arch);
}

function targetFor(platform: NodeJS.Platform, arch: string): string {
  if (!((platform === "darwin" && arch === "arm64") || (platform === "darwin" && arch === "x64")
    || (platform === "win32" && (arch === "x64" || arch === "arm64")) || (platform === "linux" && (arch === "x64" || arch === "arm64")))) {
    throw unsupported(platform, arch);
  }
  return `${platform}-${arch}`;
}

function executableFor(target: string): string {
  if (target.startsWith("darwin-")) return `${target}/LocalAppBridge.app/Contents/MacOS/LocalAppBridge`;
  if (target.startsWith("win32-")) return `${target}/localapp-native.exe`;
  return `${target}/localapp-native-ipc-client.mjs`;
}

function ipcClientFor(target: string): string {
  if (target.startsWith("darwin-")) return `${target}/LocalAppBridge.app/Contents/Resources/localapp-native-ipc-client.mjs`;
  return `${target}/localapp-native-ipc-client.mjs`;
}

function parseManifest(value: unknown, target: string, root: string, platform: NodeJS.Platform, arch: string): { signing: { mode: "adhoc" | "release" }; assets: NativeAdapterAsset[] } {
  if (!record(value) || !exactKeys(value, ["schemaVersion", "target", "signing", "assets"])
    || value.schemaVersion !== 1 || value.target !== target || !record(value.signing) || !exactKeys(value.signing, ["mode"])
    || (value.signing.mode !== "adhoc" && value.signing.mode !== "release") || !Array.isArray(value.assets) || value.assets.length === 0) {
    throw unsupported(platform, arch);
  }
  const assets = value.assets.map((asset) => {
    if (!record(asset) || !exactKeys(asset, ["path", "sha256"]) || typeof asset.path !== "string" || typeof asset.sha256 !== "string"
      || !/^[0-9a-f]{64}$/.test(asset.sha256) || !safeRelativeAsset(asset.path) || !asset.path.startsWith(`${target}/`)
      || path.resolve(root, ...asset.path.split("/")).startsWith(`${root}${path.sep}`) === false) {
      throw unsupported(platform, arch);
    }
    return { path: asset.path, sha256: asset.sha256 };
  });
  if (new Set(assets.map((asset) => asset.path)).size !== assets.length) throw unsupported(platform, arch);
  return { signing: { mode: value.signing.mode }, assets };
}

function safeRelativeAsset(value: string): boolean {
  return value.length > 0 && value.length <= 512 && !value.includes("\\") && !value.startsWith("/") && !value.endsWith("/")
    && path.posix.normalize(value) === value && value.split("/").every((part) => part && part !== "." && part !== "..");
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return keys.length === sorted.length && keys.every((key, index) => key === sorted[index]);
}

function unsupported(platform: NodeJS.Platform, arch: string): ReturnType<typeof lifecycleError> {
  return lifecycleError("native_adapter_unsupported", `NATIVE_ADAPTER_UNSUPPORTED: no LocalApp adapter is packaged for ${platform}-${arch}`);
}

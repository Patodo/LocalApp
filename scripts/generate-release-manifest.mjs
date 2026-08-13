import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const targetsPath = path.join(repoRoot, "packages/shared/release-targets.json");
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

export function buildReleaseManifest({
  assetsDir,
  baseUrl,
  version,
  minVersion = version,
  outputDir = assetsDir,
  generatedAt = sourceDate(),
}) {
  if (!SEMVER_PATTERN.test(version) || !SEMVER_PATTERN.test(minVersion)) {
    throw new Error("version and minVersion must be semantic versions");
  }
  const releaseBase = new URL(baseUrl);
  if (releaseBase.protocol !== "https:" || releaseBase.username || releaseBase.password) {
    throw new Error("baseUrl must be HTTPS without embedded credentials");
  }

  const targetConfig = readTargetConfig();
  const filename = targetConfig.npmPackage.filenameTemplate.replace("{version}", version);
  const assetPath = path.join(assetsDir, filename);
  if (!fs.existsSync(assetPath) || !fs.statSync(assetPath).isFile()) {
    throw new Error(`required release asset is missing: ${filename}`);
  }
  const bytes = fs.readFileSync(assetPath);
  const asset = {
    kind: "npm",
    version,
    os: "any",
    arch: "any",
    package: targetConfig.npmPackage.name,
    filename,
    url: new URL(encodeURIComponent(filename), ensureTrailingSlash(releaseBase)).href,
    size: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    signature: "not-applicable",
  };

  const manifest = {
    schemaVersion: 2,
    latest: version,
    min: minVersion,
    generatedAt,
    nativeAdapters: targetConfig.nativeAdapters,
    assets: [asset],
  };
  fs.mkdirSync(outputDir, { recursive: true });
  const manifestPath = path.join(outputDir, "release-manifest.json");
  const checksumsPath = path.join(outputDir, "SHA256SUMS");
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(checksumsPath, `${asset.sha256}  ${asset.filename}\n`);
  verifyReleaseOutputs({ assetsDir, manifestPath, checksumsPath });
  return { manifest, manifestPath, checksumsPath };
}

export function verifyReleaseOutputs({ assetsDir, manifestPath, checksumsPath }) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (manifest.schemaVersion !== 2 || !Array.isArray(manifest.assets) || manifest.assets.length !== 1) {
    throw new Error("release manifest must describe exactly one npm asset");
  }
  const checksumLines = fs.readFileSync(checksumsPath, "utf8").trim().split("\n").filter(Boolean);
  if (checksumLines.length !== 1) throw new Error("SHA256SUMS must describe exactly one npm asset");
  const checksum = checksumLines[0].match(/^([0-9a-f]{64})  ([A-Za-z0-9._+-]+)$/);
  if (!checksum) throw new Error(`invalid SHA256SUMS line: ${checksumLines[0]}`);

  const asset = manifest.assets[0];
  if (asset.kind !== "npm" || asset.os !== "any" || asset.arch !== "any" || asset.signature !== "not-applicable") {
    throw new Error("release manifest product asset must be the platform-neutral npm package");
  }
  if (!SHA256_PATTERN.test(asset.sha256) || checksum[2] !== asset.filename || checksum[1] !== asset.sha256) {
    throw new Error(`release asset integrity mismatch: ${asset.filename}`);
  }
  const bytes = fs.readFileSync(path.join(assetsDir, asset.filename));
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (bytes.byteLength !== asset.size || actual !== asset.sha256) {
    throw new Error(`release asset integrity mismatch: ${asset.filename}`);
  }
}

function readTargetConfig() {
  const config = JSON.parse(fs.readFileSync(targetsPath, "utf8"));
  if (config.schemaVersion !== 2 || config.npmPackage?.name !== "localapp"
    || config.npmPackage.filenameTemplate !== "localapp-{version}.tgz"
    || !Array.isArray(config.nativeAdapters) || config.nativeAdapters.length === 0) {
    throw new Error("release target fixture is invalid");
  }
  const targets = new Set();
  for (const adapter of config.nativeAdapters) {
    if (!adapter || typeof adapter.platform !== "string" || typeof adapter.arch !== "string"
      || adapter.target !== `${adapter.platform}-${adapter.arch}` || targets.has(adapter.target)) {
      throw new Error("release native adapter target is invalid");
    }
    targets.add(adapter.target);
  }
  return config;
}

function sourceDate() {
  const epoch = process.env.SOURCE_DATE_EPOCH;
  return epoch ? new Date(Number(epoch) * 1000).toISOString() : new Date().toISOString();
}

function ensureTrailingSlash(url) {
  return new URL(url.href.endsWith("/") ? url.href : `${url.href}/`);
}

function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error(`invalid argument: ${key ?? ""}`);
    values[key.slice(2)] = value;
  }
  for (const required of ["assets-dir", "base-url", "version", "output-dir"]) {
    if (!values[required]) throw new Error(`--${required} is required`);
  }
  return values;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArguments(process.argv.slice(2));
  const result = buildReleaseManifest({
    assetsDir: path.resolve(args["assets-dir"]),
    outputDir: path.resolve(args["output-dir"]),
    baseUrl: args["base-url"],
    version: args.version,
    minVersion: args["min-version"] || args.version,
  });
  console.log(JSON.stringify({
    success: true,
    assets: result.manifest.assets.length,
    manifestPath: result.manifestPath,
    checksumsPath: result.checksumsPath,
  }));
}

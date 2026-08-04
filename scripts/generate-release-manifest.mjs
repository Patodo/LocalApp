import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const targetsPath = path.join(repoRoot, "packages/shared/release-targets.json");
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const SIGNATURE_STATUSES = new Set(["signed", "ad-hoc", "unsigned", "not-applicable"]);

export function buildReleaseManifest({
  assetsDir,
  baseUrl,
  version,
  minVersion = version,
  outputDir = assetsDir,
  generatedAt = sourceDate(),
  signatureStatuses = {},
  requireDesktop = true,
}) {
  if (!SEMVER_PATTERN.test(version) || !SEMVER_PATTERN.test(minVersion)) {
    throw new Error("version and minVersion must be semantic versions");
  }
  const releaseBase = new URL(baseUrl);
  if (releaseBase.protocol !== "https:" || releaseBase.username || releaseBase.password) {
    throw new Error("baseUrl must be HTTPS without embedded credentials");
  }

  const targetConfig = JSON.parse(fs.readFileSync(targetsPath, "utf8"));
  if (targetConfig.schemaVersion !== 1 || !Array.isArray(targetConfig.targets)) {
    throw new Error("release target fixture is invalid");
  }

  const declarations = [];
  for (const target of targetConfig.targets) {
    declarations.push({
      kind: "cli",
      os: target.os,
      arch: target.arch,
      filename: target.cliFilename,
    });
    if (requireDesktop && target.desktop) {
      if (!target.desktopFilename) throw new Error(`desktop filename missing for ${target.os}/${target.arch}`);
      declarations.push({
        kind: "desktop",
        os: target.os,
        arch: target.arch,
        filename: target.desktopFilename,
      });
    }
  }

  const assets = declarations.map((declaration) => {
    const assetPath = path.join(assetsDir, declaration.filename);
    if (!fs.existsSync(assetPath) || !fs.statSync(assetPath).isFile()) {
      throw new Error(`required release asset is missing: ${declaration.filename}`);
    }
    const signature = signatureStatuses[declaration.filename];
    if (!SIGNATURE_STATUSES.has(signature)) {
      throw new Error(`real signature status is required for ${declaration.filename}`);
    }
    const bytes = fs.readFileSync(assetPath);
    return {
      kind: declaration.kind,
      version,
      os: declaration.os,
      arch: declaration.arch,
      filename: declaration.filename,
      url: new URL(encodeURIComponent(declaration.filename), ensureTrailingSlash(releaseBase)).href,
      size: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      signature,
    };
  });

  const keys = new Set();
  for (const asset of assets) {
    const key = `${asset.kind}:${asset.version}:${asset.os}:${asset.arch}`;
    if (keys.has(key)) throw new Error(`duplicate release target: ${key}`);
    keys.add(key);
  }

  const manifest = {
    schemaVersion: 1,
    latest: version,
    min: minVersion,
    generatedAt,
    assets,
  };
  fs.mkdirSync(outputDir, { recursive: true });
  const manifestPath = path.join(outputDir, "release-manifest.json");
  const checksumsPath = path.join(outputDir, "SHA256SUMS");
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(
    checksumsPath,
    `${assets.map((asset) => `${asset.sha256}  ${asset.filename}`).join("\n")}\n`,
  );
  verifyReleaseOutputs({ assetsDir, manifestPath, checksumsPath });
  return { manifest, manifestPath, checksumsPath };
}

export function verifyReleaseOutputs({ assetsDir, manifestPath, checksumsPath }) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const checksumLines = fs
    .readFileSync(checksumsPath, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean);
  if (checksumLines.length !== manifest.assets.length) {
    throw new Error("SHA256SUMS and release manifest asset counts differ");
  }
  const sums = new Map(checksumLines.map((line) => {
    const match = line.match(/^([0-9a-f]{64})  ([A-Za-z0-9._-]+)$/);
    if (!match) throw new Error(`invalid SHA256SUMS line: ${line}`);
    return [match[2], match[1]];
  }));

  for (const asset of manifest.assets) {
    if (!SHA256_PATTERN.test(asset.sha256)) throw new Error(`invalid digest for ${asset.filename}`);
    const bytes = fs.readFileSync(path.join(assetsDir, asset.filename));
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (bytes.byteLength !== asset.size || actual !== asset.sha256 || sums.get(asset.filename) !== actual) {
      throw new Error(`release asset integrity mismatch: ${asset.filename}`);
    }
  }
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
  for (const required of ["assets-dir", "base-url", "version", "output-dir", "signature-statuses"]) {
    if (!values[required]) throw new Error(`--${required} is required`);
  }
  return values;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArguments(process.argv.slice(2));
  const signatureStatuses = JSON.parse(fs.readFileSync(args["signature-statuses"], "utf8"));
  const result = buildReleaseManifest({
    assetsDir: path.resolve(args["assets-dir"]),
    outputDir: path.resolve(args["output-dir"]),
    baseUrl: args["base-url"],
    version: args.version,
    minVersion: args["min-version"] || args.version,
    signatureStatuses,
    requireDesktop: args["require-desktop"] !== "false",
  });
  console.log(JSON.stringify({
    success: true,
    assets: result.manifest.assets.length,
    manifestPath: result.manifestPath,
    checksumsPath: result.checksumsPath,
  }));
}

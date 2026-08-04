import { writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const USAGE = "Usage: node scripts/windows-release-config.mjs --output <path>";

export function buildWindowsReleaseConfig(environment = process.env) {
  const endpoint = required(environment, "LOCALAPP_UPDATER_ENDPOINT");
  const pubkey = required(environment, "LOCALAPP_UPDATER_PUBKEY");
  validateHttpsUrl(endpoint, "LOCALAPP_UPDATER_ENDPOINT");

  const certificateThumbprint = optional(
    environment,
    "LOCALAPP_WINDOWS_CERTIFICATE_THUMBPRINT",
  );
  const timestamp = optional(environment, "LOCALAPP_WINDOWS_TIMESTAMP_URL");
  const windows = {};

  if (certificateThumbprint) {
    if (!/^[a-fA-F0-9]{40}$/.test(certificateThumbprint)) {
      throw new Error(
        "LOCALAPP_WINDOWS_CERTIFICATE_THUMBPRINT must be a 40-character SHA-1 certificate thumbprint",
      );
    }
    windows.certificateThumbprint = certificateThumbprint.toUpperCase();
    windows.digestAlgorithm = "sha256";
  }

  if (timestamp) {
    if (!certificateThumbprint) {
      throw new Error(
        "LOCALAPP_WINDOWS_TIMESTAMP_URL requires LOCALAPP_WINDOWS_CERTIFICATE_THUMBPRINT",
      );
    }
    windows.timestampUrl = validateHttpsUrl(
      timestamp,
      "LOCALAPP_WINDOWS_TIMESTAMP_URL",
    ).href;
  }

  return {
    bundle: {
      createUpdaterArtifacts: true,
      windows,
    },
    plugins: {
      updater: {
        endpoints: [endpoint],
        pubkey,
        windows: { installMode: "passive" },
      },
    },
  };
}

function required(environment, name) {
  const value = optional(environment, name);
  if (!value) throw new Error(`${name} is required for a release build`);
  return value;
}

function optional(environment, name) {
  const value = environment[name];
  return typeof value === "string" ? value.trim() : "";
}

function validateHttpsUrl(value, name) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid HTTPS URL`);
  }
  if (parsed.protocol !== "https:") throw new Error(`${name} must use HTTPS`);
  if (parsed.username || parsed.password) throw new Error(`${name} must not include credentials`);
  return parsed;
}

function parseOutputArgument(arguments_) {
  if (arguments_.length !== 2 || arguments_[0] !== "--output" || !arguments_[1]) {
    throw new Error(USAGE);
  }
  return path.resolve(arguments_[1]);
}

async function main() {
  const outputPath = parseOutputArgument(process.argv.slice(2));
  const config = buildWindowsReleaseConfig(process.env);
  await writeFile(outputPath, `${JSON.stringify(config, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : USAGE);
    process.exitCode = 1;
  });
}

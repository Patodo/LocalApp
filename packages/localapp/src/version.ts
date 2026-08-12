import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export async function loadPackageVersion(manifestPath = fileURLToPath(new URL("../package.json", import.meta.url))): Promise<string> {
  const manifest: unknown = JSON.parse(await readFile(manifestPath, "utf8"));
  if (typeof manifest !== "object" || manifest === null || !("version" in manifest) || typeof manifest.version !== "string" || manifest.version.length === 0) {
    throw new Error("LocalApp package version is invalid");
  }
  return manifest.version;
}

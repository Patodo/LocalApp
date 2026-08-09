import fs from "node:fs";
import path from "node:path";
import { installAppPackage } from "../../src/lib/app-installer.js";

const [dataDir, packagePath, crashPoint] = process.argv.slice(2);
if (!dataDir || !packagePath || !crashPoint) throw new Error("dataDir, packagePath, and crashPoint are required");

const originalRename = fs.renameSync;
fs.renameSync = ((source: fs.PathLike, target: fs.PathLike) => {
  const targetPath = path.resolve(String(target));
  if (crashPoint === "after-migration" && targetPath.endsWith(`${path.sep}versions${path.sep}v2`)) {
    process.exit(71);
  }
  const result = originalRename(source, target);
  if (crashPoint === "after-activation" && targetPath.endsWith(`${path.sep}meta.json`)) {
    process.exit(72);
  }
  return result;
}) as typeof fs.renameSync;

void installAppPackage({ dataDir, ownerId: "owner", packagePath }).catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});

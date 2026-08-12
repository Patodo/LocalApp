import fs from "node:fs/promises";
import path from "node:path";

export const TEMPLATE_EXCLUDED_NAMES = new Set([
  ".DS_Store",
  ".next",
  "data",
  "dist",
  "node_modules",
  "package-lock.json",
]);

export interface CopyDestinationMutations {
  ensureDirectory(destination: string): Promise<void>;
  copyFile(source: string, destination: string): Promise<void>;
}

export async function copyDirectory(
  source: string,
  destination: string,
  excludedNames = new Set<string>(),
  destinationMutations?: CopyDestinationMutations,
): Promise<void> {
  const sourceStat = await fs.lstat(source);
  if (sourceStat.isSymbolicLink() || !sourceStat.isDirectory()) {
    throw new Error(`Refusing to copy an unsafe template directory: ${source}`);
  }
  if (destinationMutations === undefined) {
    const destinationStat = await fs.lstat(destination).catch((error: NodeJS.ErrnoException) => error.code === "ENOENT" ? undefined : Promise.reject(error));
    if (destinationStat !== undefined && (destinationStat.isSymbolicLink() || !destinationStat.isDirectory())) {
      throw new Error(`Refusing to copy through an unsafe destination: ${destination}`);
    }
    if (destinationStat === undefined) await createDirectoryWithoutSymlinks(destination);
  } else {
    await destinationMutations.ensureDirectory(destination);
  }
  const entries = await fs.readdir(source, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (excludedNames.has(entry.name) || entry.name.endsWith(".tsbuildinfo")) continue;
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      await copyDirectory(sourcePath, destinationPath, excludedNames, destinationMutations);
    } else if (entry.isFile()) {
      const currentSourceStat = await fs.lstat(sourcePath);
      if (currentSourceStat.isSymbolicLink() || !currentSourceStat.isFile()) {
        throw new Error(`Builtin template may only contain regular files: ${sourcePath}`);
      }
      if (destinationMutations === undefined) await fs.copyFile(sourcePath, destinationPath);
      else await destinationMutations.copyFile(sourcePath, destinationPath);
    } else if (entry.isSymbolicLink()) {
      throw new Error(`Builtin template may not contain symbolic links: ${sourcePath}`);
    }
  }
}

export async function isDirectory(directory: string): Promise<boolean> {
  return fs.lstat(directory).then((stat) => stat.isDirectory() && !stat.isSymbolicLink(), () => false);
}

async function createDirectoryWithoutSymlinks(directory: string): Promise<void> {
  const stat = await fs.lstat(directory).catch((error: NodeJS.ErrnoException) => error.code === "ENOENT" ? undefined : Promise.reject(error));
  if (stat !== undefined) {
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`Refusing to copy through an unsafe destination: ${directory}`);
    return;
  }
  const parent = path.dirname(directory);
  if (parent === directory) throw new Error(`Refusing to create an unsafe destination: ${directory}`);
  await createDirectoryWithoutSymlinks(parent);
  await fs.mkdir(directory);
}

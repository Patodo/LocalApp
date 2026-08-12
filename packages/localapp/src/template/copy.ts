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

export async function copyDirectory(source: string, destination: string, excludedNames = new Set<string>()): Promise<void> {
  await fs.mkdir(destination, { recursive: true });
  const entries = await fs.readdir(source, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (excludedNames.has(entry.name) || entry.name.endsWith(".tsbuildinfo")) continue;
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      await copyDirectory(sourcePath, destinationPath, excludedNames);
    } else if (entry.isFile()) {
      await fs.copyFile(sourcePath, destinationPath);
    } else if (entry.isSymbolicLink()) {
      throw new Error(`Builtin template may not contain symbolic links: ${sourcePath}`);
    }
  }
}

export async function replaceDirectory(source: string, destination: string): Promise<void> {
  await fs.rm(destination, { recursive: true, force: true });
  await copyDirectory(source, destination);
}

export async function isDirectory(directory: string): Promise<boolean> {
  return fs.stat(directory).then((stat) => stat.isDirectory(), () => false);
}

import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

// Preserve upstream module paths, native helpers and package assets. Bundling
// those plugins into a CJS file loses import.meta.url and their worker paths.
export async function copyHarnessDependencies(serverDirectory, outputDirectory) {
  const source = JSON.parse(await fs.readFile(path.join(serverDirectory, "package.json"), "utf8"));
  const roots = Object.keys(source.dependencies).filter((name) => name.startsWith("@deepseek-ai/"));
  const canonical = new Map();
  const copies = new Set();
  const outputModules = path.join(outputDirectory, "node_modules");
  async function locate(name, from) {
    const require = createRequire(path.join(from, "package.json"));
    for (const directory of require.resolve.paths(name) ?? []) {
      const candidate = path.join(directory, name, "package.json");
      try { await fs.access(candidate); return fs.realpath(path.dirname(candidate)); } catch {}
    }
    throw new Error(`Missing packaged Harness dependency: ${name}`);
  }
  async function copy(name, from, parentDestination) {
    const sourceDirectory = await locate(name, from);
    const existing = canonical.get(name);
    const destination = !existing || existing.sourceDirectory === sourceDirectory
      ? path.join(outputModules, name)
      : path.join(parentDestination, "node_modules", name);
    if (!existing) canonical.set(name, { sourceDirectory, destination });
    if (copies.has(destination)) return;
    copies.add(destination);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.cp(sourceDirectory, destination, { recursive: true, filter: (file) => {
      const relative = path.relative(sourceDirectory, file);
      // Source maps and type declarations are not used by Node. Keep the
      // compiler's declarations and all runtime/native assets intact.
      return relative.split(path.sep)[0] !== "node_modules"
        && !relative.endsWith(".map")
        && (name === "typescript" || !/\.d\.(?:ts|mts|cts)$/.test(relative));
    } });
    const metadata = JSON.parse(await fs.readFile(path.join(sourceDirectory, "package.json"), "utf8"));
    for (const dependency of new Set([...Object.keys(metadata.dependencies ?? {}), ...Object.keys(metadata.peerDependencies ?? {}), ...Object.keys(metadata.optionalDependencies ?? {})])) {
      let resolved;
      try { resolved = await locate(dependency, sourceDirectory); }
      catch (error) {
        if (metadata.optionalDependencies?.[dependency] || metadata.peerDependenciesMeta?.[dependency]?.optional) continue;
        throw error;
      }
      const inherited = canonical.get(dependency);
      if (inherited?.sourceDirectory === resolved && copies.has(inherited.destination)) continue;
      await copy(dependency, sourceDirectory, destination);
    }
  }
  // Reserve direct package versions before traversing optional peer graphs.
  for (const name of roots) canonical.set(name, { sourceDirectory: await locate(name, serverDirectory), destination: path.join(outputModules, name) });
  for (const name of roots) await copy(name, serverDirectory, outputDirectory);
}

import fs from "node:fs/promises";
import path from "node:path";

const runtimeTargets: Record<string, string> = {
  "@localapp/app-kit": ".",
  "@localapp/backend": "sdk/backend",
  "@localapp/crdt": "sdk/crdt",
  "@localapp/sdk": "sdk/core",
  "@localapp/sdk-agent": "sdk/agent",
  "@localapp/sdk-react": "sdk/react",
  "@localapp/server-core": "server-core",
};

type PackageJson = Record<string, unknown>;

export async function postprocessTemplatePackageJson(templateDirectory: string): Promise<void> {
  const runtimeDirectory = path.join(templateDirectory, "runtime");
  const packagePaths = await findPackageJsons(templateDirectory);
  for (const packagePath of packagePaths) {
    const packageJson = JSON.parse(await fs.readFile(packagePath, "utf8")) as PackageJson;
    rewriteWorkspaceDependencies(packageJson, packagePath, runtimeDirectory);
    if (packagePath === path.join(templateDirectory, "package.json")) {
      ensureAutomaticSync(packageJson);
    }
    await fs.writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
  }
}

export function rewritePackageJsonForEjectValue(packageJson: PackageJson): PackageJson {
  for (const section of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
    const dependencies = asRecord(packageJson[section]);
    if (dependencies === undefined) continue;
    for (const [name, value] of Object.entries(dependencies)) {
      if (typeof value === "string") {
        dependencies[name] = value.replaceAll("file:./.localapp/runtime", "file:./src/_localapp_runtime");
      }
    }
  }
  const scripts = asRecord(packageJson.scripts);
  if (scripts !== undefined) {
    delete scripts.postinstall;
  }
  return packageJson;
}

function rewriteWorkspaceDependencies(packageJson: PackageJson, packagePath: string, runtimeDirectory: string): void {
  for (const section of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
    const dependencies = asRecord(packageJson[section]);
    if (dependencies === undefined) continue;
    for (const [name, value] of Object.entries(dependencies)) {
      if (value !== "workspace:*") continue;
      const runtimeTarget = runtimeTargets[name];
      dependencies[name] = runtimeTarget === undefined
        ? "*"
        : packagePath === path.join(path.dirname(runtimeDirectory), "package.json")
          ? `file:./.localapp/runtime${runtimeTarget === "." ? "" : `/${runtimeTarget}`}`
          : fileDependency(path.dirname(packagePath), path.join(runtimeDirectory, runtimeTarget));
    }
  }
}

function ensureAutomaticSync(packageJson: PackageJson): void {
  if (packageJson.scripts === null || typeof packageJson.scripts !== "object" || Array.isArray(packageJson.scripts)) {
    packageJson.scripts = {};
  }
  (packageJson.scripts as Record<string, unknown>).postinstall = "node .localapp/runtime/sync-template.cjs";
}

function fileDependency(fromDirectory: string, target: string): string {
  const relative = path.relative(fromDirectory, target).split(path.sep).join("/");
  return `file:${relative.startsWith(".") ? relative : `./${relative}`}`;
}

async function findPackageJsons(directory: string): Promise<string[]> {
  const results: string[] = [];
  async function visit(current: string): Promise<void> {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(entryPath);
      else if (entry.isFile() && entry.name === "package.json") results.push(entryPath);
    }
  }
  await visit(directory);
  return results;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

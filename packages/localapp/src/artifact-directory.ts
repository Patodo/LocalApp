import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The packaged artifact this CLI belongs to: the directory holding `runtime/`
 * and `.localapp-artifact.json`. A published install exposes the entrypoint as
 * `bin/localapp.mjs`, directly or through an npm bin shim, so the artifact root
 * is always the entrypoint's parent directory.
 */
export function artifactDirectoryFromEntrypoint(entrypoint: string): string {
  const canonical = realpathSync(entrypoint);
  return path.resolve(path.dirname(canonical), "..");
}

/**
 * The artifact directory this process runs from. `argv[1]` is the real
 * entrypoint for every CLI invocation; the module-relative root keeps
 * programmatic imports (and an unresolvable entrypoint) working instead of
 * failing with a bare ENOENT.
 */
export function localAppArtifactDirectory(entrypoint: string | undefined = process.argv[1]): string {
  if (entrypoint !== undefined && entrypoint.length > 0) {
    try {
      return artifactDirectoryFromEntrypoint(entrypoint);
    } catch {
      // Not a resolvable entrypoint; the module-relative root is authoritative.
    }
  }
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

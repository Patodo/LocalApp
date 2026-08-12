import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const packageDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(process.env.LOCALAPP_REPOSITORY_ROOT ?? path.resolve(packageDirectory, "../.."));
const sourceManifest = JSON.parse(await fs.readFile(path.join(packageDirectory, "package.json"), "utf8"));
const outputDirectory = path.resolve(process.argv[2] ?? path.join(packageDirectory, "template"));
const stagingEntrypoint = path.join(path.dirname(outputDirectory), ".localapp-stage-template.mjs");

await build({
  absWorkingDir: repositoryRoot,
  bundle: true,
  entryPoints: [path.join(packageDirectory, "src/template/stage.ts")],
  format: "esm",
  legalComments: "none",
  outfile: stagingEntrypoint,
  platform: "node",
  target: "node24",
});
try {
  const { stageBuiltinTemplate } = await import(pathToFileURL(stagingEntrypoint).href);
  await stageBuiltinTemplate({ repositoryRoot, outputDirectory, version: sourceManifest.version });
} finally {
  await fs.rm(stagingEntrypoint, { force: true });
}

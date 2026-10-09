import fs from "node:fs/promises";
import path from "node:path";

// dsh-llm reads its package version using import.meta.url. Embed that metadata
// when producing the single-package CommonJS runtime so no source path is needed.
export function harnessBundlePlugin() {
  return {
    name: "localapp-harness-metadata",
    setup(build) {
      build.onLoad({ filter: /deepseek-capabilities\.mts$/ }, async ({ path: entry }) => ({ contents: (await fs.readFile(entry, "utf8")).replace("createRequire(typeof __filename === \"string\" ? __filename : import.meta.url)", "createRequire(__filename)"), loader: "ts" }));
      build.onLoad({ filter: /[\\/]@deepseek-ai[\\/]dsh-llm[\\/]lib[\\/]index\.js$/ }, async ({ path: entry }) => {
        const source = await fs.readFile(entry, "utf8");
        const metadata = JSON.parse(await fs.readFile(path.resolve(path.dirname(entry), "../package.json"), "utf8"));
        const expression = 'createRequire(import.meta.url)("../package.json")';
        if (!source.includes(expression)) throw new Error("DeepSeek Harness package metadata changed; update the bundle integration");
        return { contents: source.replace(expression, JSON.stringify({ version: metadata.version })), loader: "js" };
      });
    },
  };
}

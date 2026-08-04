import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(__dirname, "../../..");

describe("PlatformShell route contract", () => {
  it("uses a dedicated platform-shell route for the shell template source and export", () => {
    expect(fs.existsSync(path.join(repoRoot, "packages/web/app/platform-shell/[userId]/[name]/page.tsx"))).toBe(true);
    expect(fs.existsSync(path.join(repoRoot, "packages/web/app/serve/[userId]/[name]/page.tsx"))).toBe(false);

    const outDir = path.join(repoRoot, "packages/web/out");
    if (fs.existsSync(outDir)) {
      expect(fs.existsSync(path.join(outDir, "platform-shell/placeholder/placeholder.html"))).toBe(true);
    }
  });

  it("does not configure Next dev to rewrite /serve because server owns that raw app path", async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    const configModule = await import("../../web/next.config.ts");
    const config = configModule.default;
    const rewrites = typeof config.rewrites === "function" ? await config.rewrites() : [];
    process.env.NODE_ENV = previousNodeEnv;

    expect(rewrites).not.toContainEqual(
      expect.objectContaining({ source: "/serve/:path*" }),
    );
    expect(rewrites).toContainEqual(
      expect.objectContaining({
        source: "/_localapp/raw/:userId/:name",
        destination: "http://localhost:3000/serve/:userId/:name/",
      }),
    );
    expect(rewrites).toContainEqual(
      expect.objectContaining({
        source: "/_localapp/raw/:userId/:name/:path*",
        destination: "http://localhost:3000/serve/:userId/:name/:path*",
      }),
    );
  });
});

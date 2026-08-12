import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  APP_PACKAGE_SCHEMA_VERSION,
  writeAppPackage,
  type AppPackageMetadata,
  type PortablePackageFile,
} from "../src/lib/app-package.js";

const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
const testRoot = path.join(repositoryRoot, "tmp/task-4-server-package-writer-tests");
const directories: string[] = [];

beforeAll(() => {
  fs.mkdirSync(testRoot, { recursive: true });
});

afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe("application package writer ownership", () => {
  it("rejects invalid metadata before creating the output parent or file", async () => {
    // Break caught: opening the wx stream before validation mutates the filesystem for an input that can never be packaged.
    const directory = createCase();
    const outputParent = path.join(directory, "not-created");
    const outputPath = path.join(outputParent, "invalid.localapp");

    await expect(writeAppPackage({
      outputPath,
      metadata: { ...validMetadata(), schemaVersion: 999 },
      files: validFiles(),
    })).rejects.toBeTruthy();

    expect(fs.existsSync(outputParent)).toBe(false);
    expect(fs.existsSync(outputPath)).toBe(false);
  });

  it("does not remove an existing output when file validation fails", async () => {
    // Break caught: unconditional failure cleanup can delete a path the writer never opened or owned.
    const directory = createCase();
    const outputPath = path.join(directory, "existing.localapp");
    const sentinel = Buffer.from("existing owner data\n");
    fs.writeFileSync(outputPath, sentinel);

    await expect(writeAppPackage({
      outputPath,
      metadata: validMetadata(),
      files: validFiles().filter((file) => file.path !== "dist/index.html"),
    })).rejects.toBeTruthy();

    expect(fs.readFileSync(outputPath)).toEqual(sentinel);
  });

  it("removes an output owned by the call after a post-open stream failure", async () => {
    // Break caught: validation-first must not turn stream failures into persistent empty or partial packages.
    const directory = createCase();
    const outputPath = path.join(directory, "failed.localapp");

    await expect(writeAppPackage({
      outputPath,
      metadata: validMetadata(),
      files: validFiles(),
    }, {
      afterOpen: (output) => output.destroy(new Error("injected post-open failure")),
    })).rejects.toThrow("injected post-open failure");

    expect(fs.existsSync(outputPath)).toBe(false);
  });
});

function createCase(): string {
  const directory = fs.mkdtempSync(path.join(testRoot, "case-"));
  directories.push(directory);
  return directory;
}

function validMetadata(): AppPackageMetadata {
  return {
    schemaVersion: APP_PACKAGE_SCHEMA_VERSION,
    appId: "writer-test",
    version: "1.0.0",
    platformVersion: "^1.2",
  };
}

function validFiles(): PortablePackageFile[] {
  return [
    { path: "manifest.json", content: Buffer.from(`${JSON.stringify({ name: "writer-test", distDir: "dist" })}\n`) },
    { path: "dist/index.html", content: Buffer.from("<main>writer test</main>\n") },
  ];
}

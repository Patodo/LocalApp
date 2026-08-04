import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../config.js";

describe("application data archive configuration", () => {
  const directories: string[] = [];
  afterEach(() => directories.splice(0).forEach((directory) => fs.rmSync(directory, { recursive: true, force: true })));

  function env(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "localapp-config-"));
    directories.push(dataDir);
    return { DATA_DIR: dataDir, ...overrides };
  }

  it("uses safe default archive limits", async () => {
    await expect(loadConfig(env())).resolves.toMatchObject({
      appDataArchiveMaxBytes: 2 * 1024 * 1024 * 1024,
      appDataExpandedMaxBytes: 4 * 1024 * 1024 * 1024,
      appDataArchiveMaxFiles: 10_000,
    });
  });

  it("loads positive integer archive limits from the environment", async () => {
    await expect(loadConfig(env({
      APP_DATA_ARCHIVE_MAX_BYTES: "1000",
      APP_DATA_EXPANDED_MAX_BYTES: "2000",
      APP_DATA_ARCHIVE_MAX_FILES: "30",
    }))).resolves.toMatchObject({
      appDataArchiveMaxBytes: 1000,
      appDataExpandedMaxBytes: 2000,
      appDataArchiveMaxFiles: 30,
    });
  });

  it("rejects invalid archive limits", async () => {
    await expect(loadConfig(env({ APP_DATA_ARCHIVE_MAX_FILES: "0" }))).rejects.toThrow("APP_DATA_ARCHIVE_MAX_FILES must be a positive integer");
  });
});

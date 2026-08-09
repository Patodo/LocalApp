import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  readPageMeta,
  resolveVersionPublisher,
  writePageMeta,
  type PageMeta,
} from "../../src/plugins/storage.js";
import { createTestUser } from "../helpers/createUser.js";
import { createTestServer, getAppUrl } from "./helpers.js";

describe("release publisher attribution", () => {
  let app: FastifyInstance;
  let baseUrl: string;
  let dataDir: string;
  let stop: () => Promise<void>;

  beforeAll(async () => {
    const server = await createTestServer();
    app = server.app;
    baseUrl = getAppUrl(app);
    dataDir = server.dataDir;
    stop = server.stop;
  });

  afterAll(async () => {
    await stop();
  });

  it("persists the authenticated uploader while preserving legacy releases", async () => {
    const { apiKey, cookie } = await createTestUser(baseUrl, "releasepublisher");
    const profileResponse = await fetch(`${baseUrl}/api/me/profile`, {
      method: "PUT",
      headers: { cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: "Release Publisher" }),
    });
    expect(profileResponse.status).toBe(200);

    const pageResponse = await fetch(`${baseUrl}/api/pages`, {
      method: "POST",
      headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "publisher-app" }),
    });
    expect(pageResponse.status).toBe(200);

    const meta = readPageMeta(dataDir, "releasepublisher", "publisher-app");
    expect(meta).not.toBeNull();
    const legacyVersion = {
      version: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
      fileCount: 1,
      totalSize: 42,
    };
    meta!.currentVersion = 1;
    meta!.versions = [legacyVersion];
    writePageMeta(dataDir, "releasepublisher", "publisher-app", meta!);

    const form = new FormData();
    form.append("name", "publisher-app");
    form.append("filepath_0", "index.html");
    form.append("files", new Blob(["<html>publisher</html>"], { type: "text/html" }), "index.html");
    const uploadResponse = await fetch(`${baseUrl}/api/upload`, {
      method: "POST",
      headers: { "X-API-Key": apiKey },
      body: form,
    });
    expect(uploadResponse.status).toBe(200);

    const updated = readPageMeta(dataDir, "releasepublisher", "publisher-app");
    expect(updated?.versions[0]).toMatchObject({
      ...legacyVersion,
      appVersion: "legacy-1",
      digest: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(updated?.versions[0]).not.toHaveProperty("uploaderId");
    expect(updated?.versions[0]).not.toHaveProperty("uploaderDisplayName");
    expect(updated?.versions[1]).toMatchObject({
      version: 2,
      uploaderId: "releasepublisher",
      uploaderDisplayName: "Release Publisher",
    });
  });

  it("resolves legacy releases to the app owner until a release has uploader metadata", () => {
    const meta: PageMeta = {
      name: "publisher-app",
      userId: "app-owner",
      description: "",
      currentVersion: 2,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
      metadata: {},
      versions: [
        { version: 1, createdAt: "2026-01-01T00:00:00.000Z", fileCount: 1, totalSize: 42 },
        {
          version: 2,
          createdAt: "2026-01-02T00:00:00.000Z",
          fileCount: 1,
          totalSize: 43,
          uploaderId: "release-publisher",
          uploaderDisplayName: "Release Publisher",
        },
      ],
    };

    expect(resolveVersionPublisher(meta, 1)).toEqual({ userId: "app-owner" });
    expect(resolveVersionPublisher(meta)).toEqual({
      userId: "release-publisher",
      displayName: "Release Publisher",
    });
  });
});

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  PLATFORM_CAPABILITIES,
  PLATFORM_CAPABILITIES_SOURCE_SHA256,
} from "../../generated/platform-capabilities.js";

const workspaceRoot = resolve(process.cwd(), "../..");
const sourcePath = resolve(workspaceRoot, "platform/capabilities.json");
const schemaPath = resolve(workspaceRoot, "platform/capabilities.schema.json");
const runtimePath = resolve(
  workspaceRoot,
  "init-repo/runtime/platform-capabilities.json",
);

describe("platform capability contract", () => {
  it("declares the versioned content, backend, identity, collaboration, and verification contract", async () => {
    const source = JSON.parse(await readFile(sourcePath, "utf8"));
    const schema = JSON.parse(await readFile(schemaPath, "utf8"));

    expect(schema.required).toEqual(
      expect.arrayContaining([
        "schemaVersion",
        "platformVersion",
        "content",
        "backend",
        "identity",
        "collaboration",
        "verification",
      ]),
    );
    expect(source).toMatchObject({
      schemaVersion: 1,
      platformVersion: "1.3.0",
      content: {
        upload: {
          enabled: true,
          maxBytes: 10 * 1024 * 1024,
          validatesFileSignature: true,
        },
        read: { enabled: true, rangeRequests: true },
        types: expect.arrayContaining([
          { extension: "pdf", mimeType: "application/pdf", inlinePreview: true },
        ]),
      },
      backend: {
        stableMode: "named-sql",
        namedSql: { enabled: true },
        hostedActions: { enabled: false, stable: false },
        securityContracts: {
          enabled: true,
          contractVersion: 1,
          requiredFromPlatformVersion: "1.1.0",
          customScenarios: true,
        },
      },
      identity: expect.any(Object),
      collaboration: {
        recordVersioned: { enabled: true },
        crdt: {
          enabled: true,
          protocol: "yjs-v1",
          maxDocumentBytes: 16 * 1024 * 1024,
          awareness: true,
          editingOverlay: true,
        },
      },
      verification: {
        enabled: true,
        isolatedDatabase: true,
        identities: ["owner", "member"],
        maxConcurrentSessions: 8,
        maxDatabaseBytes: 64 * 1024 * 1024,
      },
    });
  });

  it("keeps generated TypeScript and init runtime copies identical to the source", async () => {
    const sourceBytes = await readFile(sourcePath);
    const source = JSON.parse(sourceBytes.toString("utf8"));
    const runtime = JSON.parse(await readFile(runtimePath, "utf8"));
    const hash = createHash("sha256").update(sourceBytes).digest("hex");

    expect(PLATFORM_CAPABILITIES).toEqual(source);
    expect(runtime).toEqual(source);
    expect(PLATFORM_CAPABILITIES_SOURCE_SHA256).toBe(hash);
  });
});

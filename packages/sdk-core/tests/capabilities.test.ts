import { afterEach, describe, expect, it, vi } from "vitest";

import { createClient, type PlatformCapabilities } from "../src/index.js";

const capabilities: PlatformCapabilities = {
  $schema: "./capabilities.schema.json",
  schemaVersion: 1,
  platformVersion: "1.2.0",
  content: {
    upload: { enabled: true, maxBytes: 10 * 1024 * 1024, validatesFileSignature: false },
    read: { enabled: true, rangeRequests: false, delete: false },
    types: [{ extension: "png", mimeType: "image/png", inlinePreview: true }],
  },
  backend: {
    stableMode: "named-sql",
    namedSql: {
      enabled: true,
      transactions: true,
      maxRows: 1000,
      maxBytes: 1024 * 1024,
      systemParams: ["currentUserId", "ownerId", "now"],
    },
    hostedActions: { enabled: false, stable: false },
    securityContracts: {
      enabled: true,
      contractVersion: 1,
      requiredFromPlatformVersion: "1.1.0",
      generatedTemplates: ["authenticated-v1", "owner-read-v1"],
      customScenarios: true,
    },
  },
  identity: { currentUser: true, pageOwner: true, groups: true },
  verification: {
    enabled: true,
    isolatedDatabase: true,
    identities: ["owner", "member"],
    defaultTtlSeconds: 300,
    maxTtlSeconds: 600,
    maxConcurrentSessions: 8,
    maxDatabaseBytes: 64 * 1024 * 1024,
  },
};

describe("LocalAppClient capabilities", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads the public platform endpoint independently of the app base path", async () => {
    vi.stubGlobal("window", { location: { pathname: "/serve/alice/workload/" } });
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ success: true, data: capabilities }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ));
    vi.stubGlobal("fetch", fetchMock);

    const result = await createClient().capabilities();

    expect(fetchMock).toHaveBeenCalledWith("/api/platform/capabilities", { method: "GET" });
    expect(result).toEqual(capabilities);
    expect(result.backend.securityContracts.enabled).toBe(true);
    expect(result.verification.maxConcurrentSessions).toBe(8);
  });
});

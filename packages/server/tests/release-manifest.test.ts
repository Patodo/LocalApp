import { describe, expect, it, vi } from "vitest";
import {
  ReleaseManifestClient,
  ReleaseManifestError,
  findCliAsset,
  type ReleaseManifest,
} from "../src/lib/release-manifest.js";

function manifest(overrides: Partial<ReleaseManifest> = {}): ReleaseManifest {
  return {
    schemaVersion: 1,
    latest: "1.2.0",
    min: "1.0.0",
    generatedAt: "2026-07-30T00:00:00.000Z",
    assets: [
      {
        kind: "cli",
        version: "1.2.0",
        os: "windows",
        arch: "x86_64",
        filename: "localapp-cli-x86_64-pc-windows-msvc.exe",
        url: "https://releases.example/localapp-cli-x86_64-pc-windows-msvc.exe",
        size: 12,
        sha256: "a".repeat(64),
        signature: "unsigned",
      },
      {
        kind: "cli",
        version: "1.1.0",
        os: "linux",
        arch: "x86_64",
        filename: "localapp-cli-x86_64-unknown-linux-gnu",
        url: "https://releases.example/localapp-cli-x86_64-unknown-linux-gnu",
        size: 10,
        sha256: "b".repeat(64),
        signature: "unsigned",
      },
    ],
    ...overrides,
  };
}

function response(body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("ReleaseManifestClient", () => {
  it("follows an HTTPS release-host redirect without treating the CDN origin as the manifest trust origin", async () => {
    const fetcher = vi.fn(async (_input: string, init?: RequestInit) => {
      expect(init?.redirect).toBe("follow");
      return Object.defineProperty(response(manifest()), "url", {
        value: "https://objects.example/release-manifest.json",
      });
    });
    const client = new ReleaseManifestClient({
      manifestUrl: "https://releases.example/release-manifest.json",
      fetcher,
    });

    await expect(client.get()).resolves.toMatchObject({
      stale: false,
      manifest: { latest: "1.2.0" },
    });
  });

  it("aborts a stalled manifest request and reports the source as unavailable", async () => {
    const fetcher = vi.fn((_input: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    }));
    const client = new ReleaseManifestClient({
      manifestUrl: "https://releases.example/release-manifest.json",
      fetcher,
      requestTimeoutMs: 10,
    });

    await expect(client.get()).rejects.toMatchObject({
      code: "CLI_RELEASE_MANIFEST_UNAVAILABLE",
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("requires an HTTPS manifest URL before making a request", async () => {
    const fetcher = vi.fn();
    const client = new ReleaseManifestClient({
      manifestUrl: "http://releases.example/release-manifest.json",
      fetcher,
    });

    await expect(client.get()).rejects.toMatchObject({
      code: "CLI_RELEASE_MANIFEST_INVALID",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects response bodies over the configured byte limit", async () => {
    const client = new ReleaseManifestClient({
      manifestUrl: "https://releases.example/release-manifest.json",
      maxBytes: 32,
      fetcher: vi.fn(async () => response("x".repeat(33))),
    });

    await expect(client.get()).rejects.toMatchObject({
      code: "CLI_RELEASE_MANIFEST_INVALID",
    });
  });

  it("rejects malformed schemas, duplicate targets, and unsafe asset URLs", async () => {
    const invalidManifests = [
      { schemaVersion: 1, latest: "1.0.0" },
      manifest({ assets: [manifest().assets[0]!, manifest().assets[0]!] }),
      manifest({
        assets: [
          {
            ...manifest().assets[0]!,
            url: "http://releases.example/localapp.exe",
          },
        ],
      }),
      manifest({
        assets: [
          {
            ...manifest().assets[0]!,
            url: "https://untrusted.example/localapp.exe",
          },
        ],
      }),
    ];

    for (const invalid of invalidManifests) {
      const client = new ReleaseManifestClient({
        manifestUrl: "https://releases.example/release-manifest.json",
        fetcher: vi.fn(async () => response(invalid)),
      });
      await expect(client.get()).rejects.toBeInstanceOf(ReleaseManifestError);
    }
  });

  it("accepts complete SemVer and rejects malformed versions", async () => {
    const valid = manifest({
      latest: "1.2.0-rc.1+build.7",
      min: "1.0.0+baseline",
      assets: manifest().assets.map((asset) => ({
        ...asset,
        version: "1.2.0-rc.1+build.7",
      })),
    });
    const validClient = new ReleaseManifestClient({
      manifestUrl: "https://releases.example/release-manifest.json",
      fetcher: vi.fn(async () => response(valid)),
    });
    await expect(validClient.get()).resolves.toMatchObject({
      manifest: { latest: "1.2.0-rc.1+build.7" },
    });

    for (const latest of ["01.2.3", "1.2.3-", "1.2.3-01", "1.2.3+"]) {
      const client = new ReleaseManifestClient({
        manifestUrl: "https://releases.example/release-manifest.json",
        fetcher: vi.fn(async () => response(manifest({ latest }))),
      });
      await expect(client.get()).rejects.toBeInstanceOf(ReleaseManifestError);
    }
  });

  it("uses a fresh cache and falls back to a bounded last successful value", async () => {
    let now = 1_000;
    const fetcher = vi
      .fn<() => Promise<Response>>()
      .mockResolvedValueOnce(response(manifest()))
      .mockRejectedValueOnce(new Error("temporary outage"));
    const client = new ReleaseManifestClient({
      manifestUrl: "https://releases.example/release-manifest.json",
      fetcher,
      now: () => now,
      cacheTtlMs: 100,
      staleTtlMs: 1_000,
    });

    const first = await client.get();
    const cached = await client.get();
    now += 200;
    const stale = await client.get();

    expect(first.stale).toBe(false);
    expect(cached.stale).toBe(false);
    expect(stale.stale).toBe(true);
    expect(stale.fetchedAt).toBe(1_000);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("returns an unavailable error when no valid manifest or fallback exists", async () => {
    const client = new ReleaseManifestClient({
      manifestUrl: "https://releases.example/release-manifest.json",
      fetcher: vi.fn(async () => {
        throw new Error("offline");
      }),
    });

    await expect(client.get()).rejects.toMatchObject({
      code: "CLI_RELEASE_MANIFEST_UNAVAILABLE",
    });
  });

  it("treats an unconfigured source as unavailable and invalid JSON as invalid", async () => {
    const unconfigured = new ReleaseManifestClient({ manifestUrl: "" });
    const malformed = new ReleaseManifestClient({
      manifestUrl: "https://releases.example/release-manifest.json",
      fetcher: vi.fn(async () => response("{")),
    });

    await expect(unconfigured.get()).rejects.toMatchObject({
      code: "CLI_RELEASE_MANIFEST_UNAVAILABLE",
    });
    await expect(malformed.get()).rejects.toMatchObject({
      code: "CLI_RELEASE_MANIFEST_INVALID",
    });
  });
});

describe("findCliAsset", () => {
  it("matches version, operating system, and architecture exactly", () => {
    const found = findCliAsset(manifest(), {
      version: "1.2.0",
      os: "windows",
      arch: "x86_64",
    });

    expect(found?.filename).toBe("localapp-cli-x86_64-pc-windows-msvc.exe");
    expect(
      findCliAsset(manifest(), {
        version: "1.2.0",
        os: "freebsd",
        arch: "x86_64",
      }),
    ).toBeUndefined();
  });
});

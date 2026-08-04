import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { createTestServer, getAppUrl, getTestApiKey } from "./helpers.js";
import type { FastifyInstance } from "fastify";

describe("server-config — env vars", () => {
  let app: FastifyInstance;
  let baseUrl: string;
  let stop: () => Promise<void>;
  const apiKey = getTestApiKey();

  beforeAll(async () => {
    const server = await createTestServer();
    app = server.app;
    baseUrl = getAppUrl(app);
    stop = server.stop;
  });

  afterAll(async () => {
    await stop();
  });

  it("should return config with valid API key", async () => {
    const res = await fetch(`${baseUrl}/api/config`, {
      headers: { "X-API-Key": apiKey },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.templateRepoUrl).toBe("https://github.com/example/template.git");
    expect(data.gitDownloadUrl).toBe("https://example.com/git-install.exe");
  });

  it("should return 401 without API key", async () => {
    const res = await fetch(`${baseUrl}/api/config`);
    expect(res.status).toBe(401);
  });

  it("should return 401 with invalid API key", async () => {
    const res = await fetch(`${baseUrl}/api/config`, {
      headers: { "X-API-Key": "invalid-key" },
    });
    expect(res.status).toBe(401);
  });

  it("should return null gitDownloadUrl when not configured", async () => {
    const server = await createTestServer({ env: { GIT_DOWNLOAD_URL: undefined } });
    const baseUrl = getAppUrl(server.app);
    try {
      const res = await fetch(`${baseUrl}/api/config`, {
        headers: { "X-API-Key": apiKey },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.gitDownloadUrl).toBeNull();
    } finally {
      await server.stop();
    }
  });
});

describe("server-config — config.toml", () => {
  const apiKey = getTestApiKey();

  it("starts normally when config.toml does not exist (env vars only)", async () => {
    const server = await createTestServer();
    const baseUrl = getAppUrl(server.app);
    try {
      const res = await fetch(`${baseUrl}/api/config`, {
        headers: { "X-API-Key": apiKey },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.templateRepoUrl).toBe("https://github.com/example/template.git");
    } finally {
      await server.stop();
    }
  });

  it("reads templateRepoUrl from config.toml when env var is not set", async () => {
    const server = await createTestServer({
      configToml: '[template]\nrepo_url = "https://from-toml.example.com/repo.git"',
      env: { TEMPLATE_REPO_URL: undefined },
    });
    const baseUrl = getAppUrl(server.app);
    try {
      const res = await fetch(`${baseUrl}/api/config`, {
        headers: { "X-API-Key": apiKey },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.templateRepoUrl).toBe("https://from-toml.example.com/repo.git");
    } finally {
      await server.stop();
    }
  });

  it("env variable takes priority over config.toml", async () => {
    const server = await createTestServer({
      configToml: '[template]\nrepo_url = "https://from-toml.example.com"',
      env: { TEMPLATE_REPO_URL: "https://from-env.example.com" },
    });
    const baseUrl = getAppUrl(server.app);
    try {
      const res = await fetch(`${baseUrl}/api/config`, {
        headers: { "X-API-Key": apiKey },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.templateRepoUrl).toBe("https://from-env.example.com");
    } finally {
      await server.stop();
    }
  });

  it("fails to start with invalid config.toml", async () => {
    await expect(
      createTestServer({
        configToml: "this is not valid toml {{{{",
        env: { TEMPLATE_REPO_URL: undefined },
      }),
    ).rejects.toThrow(/Failed to parse/);
  });
});

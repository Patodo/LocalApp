import fs from "node:fs";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTestServer, getAppUrl, getTestApiKey } from "./helpers.js";
import { registerAndLogin } from "../helpers/createUser.js";

const PEER_API_KEY = "peer-api-key-that-must-not-leak";

describe("peer connections", () => {
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

  afterAll(async () => { await stop(); });
  afterEach(() => vi.unstubAllGlobals());

  async function adminRequest(path: string, init: RequestInit = {}) {
    return fetch(`${baseUrl}${path}`, {
      ...init,
      headers: { "x-api-key": getTestApiKey(), ...(init.body ? { "content-type": "application/json" } : {}), ...init.headers },
    });
  }

  it("stores an encrypted API key and returns only public peer metadata", async () => {
    const created = await adminRequest("/api/peers", {
      method: "POST",
      body: JSON.stringify({ name: "loopback", baseUrl, apiKey: PEER_API_KEY, acceptInsecureHttp: true }),
    });
    expect(created.status).toBe(201);
    const body = await created.json();
    expect(body.data).not.toHaveProperty("apiKey");
    expect(body.data).not.toHaveProperty("credential");
    expect(JSON.stringify(body)).not.toContain(PEER_API_KEY);
    expect(fs.readFileSync(`${dataDir}/meta.sqlite`, "utf8")).not.toContain(PEER_API_KEY);

    const listed = await adminRequest("/api/peers");
    expect(listed.status).toBe(200);
    expect(JSON.stringify(await listed.json())).not.toContain(PEER_API_KEY);
  });

  it("rejects unsafe URLs and public HTTP while allowing explicitly acknowledged loopback HTTP", async () => {
    for (const baseUrl of ["https://user:pass@example.test", "https://example.test/#fragment", "ftp://example.test", "http://example.test"]) {
      const result = await adminRequest("/api/peers", {
        method: "POST",
        body: JSON.stringify({ name: `invalid-${Math.random()}`, baseUrl, apiKey: PEER_API_KEY, acceptInsecureHttp: true }),
      });
      expect(result.status, baseUrl).toBe(400);
      expect(await result.text()).not.toContain(PEER_API_KEY);
    }

    const allowed = await adminRequest("/api/peers", {
      method: "POST",
      body: JSON.stringify({ name: "explicit-loopback", baseUrl: "http://127.0.0.1:43127/path/", apiKey: PEER_API_KEY, acceptInsecureHttp: true }),
    });
    expect(allowed.status).toBe(201);
    expect((await allowed.json()).data.baseUrl).toBe("http://127.0.0.1:43127/path");
  });

  it("checks target capabilities with a bearer credential and persists only verified public metadata", async () => {
    const created = await adminRequest("/api/peers", {
      method: "POST",
      body: JSON.stringify({ name: "capability-target", baseUrl, apiKey: getTestApiKey(), acceptInsecureHttp: true }),
    });
    const peer = (await created.json()).data;

    const checked = await adminRequest(`/api/peers/${encodeURIComponent(peer.id)}/check`, { method: "POST" });
    expect(checked.status).toBe(200);
    const body = await checked.json();
    expect(body.data.verifiedUser).toMatchObject({ id: "localadmin", name: "localadmin" });
    expect(body.data.protocolVersion).toBe(2);
    expect(body.data.transferLimits.maxPackageBytes).toBeGreaterThan(0);
    expect(body.data.verifiedAt).toEqual(expect.any(String));
    expect(JSON.stringify(body)).not.toContain(getTestApiKey());
  });

  it("requires an administrator for peer management and bearer authentication for capabilities", async () => {
    const userCookie = await registerAndLogin(baseUrl, "peer-ordinary-user", "pass123456");
    const forbidden = await fetch(`${baseUrl}/api/peers`, { headers: { cookie: userCookie } });
    expect(forbidden.status).toBe(403);

    expect((await fetch(`${baseUrl}/api/peer/capabilities`)).status).toBe(401);
    expect((await fetch(`${baseUrl}/api/peer/capabilities`, { headers: { authorization: "Bearer invalid" } })).status).toBe(401);
    const allowed = await fetch(`${baseUrl}/api/peer/capabilities`, { headers: { authorization: `Bearer ${getTestApiKey()}` } });
    expect(allowed.status).toBe(200);
    expect(JSON.stringify(await allowed.json())).not.toContain(getTestApiKey());
  });

  it("replaces and removes credentials without exposing them", async () => {
    const created = await adminRequest("/api/peers", {
      method: "POST",
      body: JSON.stringify({ name: "replace-peer", baseUrl, apiKey: PEER_API_KEY, acceptInsecureHttp: true }),
    });
    const peer = (await created.json()).data;
    const replaced = await adminRequest(`/api/peers/${encodeURIComponent(peer.id)}`, {
      method: "PATCH",
      body: JSON.stringify({ apiKey: "replacement-peer-api-key", name: "renamed-peer" }),
    });
    expect(replaced.status).toBe(200);
    expect(JSON.stringify(await replaced.json())).not.toContain("replacement-peer-api-key");
    expect((await adminRequest(`/api/peers/${encodeURIComponent(peer.id)}`, { method: "DELETE" })).status).toBe(204);
    expect((await adminRequest(`/api/peers/${encodeURIComponent(peer.id)}/check`, { method: "POST" })).status).toBe(404);
  });

  it("rejects a delayed capability result when the peer connection changes", async () => {
    const peer = await createPeerForRace("patch-race-peer");
    const deferred = createDeferredResponse();
    vi.stubGlobal("fetch", vi.fn(() => { deferred.fetchStarted(); return deferred.promise; }));
    const checking = app.inject({ method: "POST", url: `/api/peers/${peer.id}/check`, headers: { "x-api-key": getTestApiKey() } });
    await deferred.started;

    const patched = await app.inject({
      method: "PATCH", url: `/api/peers/${peer.id}`, headers: { "x-api-key": getTestApiKey(), "content-type": "application/json" },
      payload: { apiKey: "replacement-peer-api-key" },
    });
    expect(patched.statusCode).toBe(200);
    deferred.resolve(capabilitiesResponse());

    const response = await checking;
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ success: false, error: "Peer configuration changed during capability check" });
    const listed = await app.inject({ method: "GET", url: "/api/peers", headers: { "x-api-key": getTestApiKey() } });
    expect(listed.json().data.find((item: { id: string }) => item.id === peer.id).verifiedAt).toBeNull();
  });

  it("returns not found when a peer is deleted during a delayed capability check", async () => {
    const peer = await createPeerForRace("delete-race-peer");
    const deferred = createDeferredResponse();
    vi.stubGlobal("fetch", vi.fn(() => { deferred.fetchStarted(); return deferred.promise; }));
    const checking = app.inject({ method: "POST", url: `/api/peers/${peer.id}/check`, headers: { "x-api-key": getTestApiKey() } });
    await deferred.started;

    expect((await app.inject({ method: "DELETE", url: `/api/peers/${peer.id}`, headers: { "x-api-key": getTestApiKey() } })).statusCode).toBe(204);
    deferred.resolve(capabilitiesResponse());

    const response = await checking;
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ success: false, error: "Peer not found" });
  });

  async function createPeerForRace(name: string): Promise<{ id: string }> {
    const response = await app.inject({
      method: "POST", url: "/api/peers", headers: { "x-api-key": getTestApiKey(), "content-type": "application/json" },
      payload: { name, baseUrl: "https://peer.example", apiKey: PEER_API_KEY },
    });
    expect(response.statusCode).toBe(201);
    return response.json().data;
  }
});

function createDeferredResponse() {
  let resolveResponse: (response: Response) => void = () => undefined;
  let resolveStarted: () => void = () => undefined;
  return {
    promise: new Promise<Response>((resolve) => { resolveResponse = resolve; }),
    started: new Promise<void>((resolve) => { resolveStarted = resolve; }),
    resolve(response: Response) { resolveResponse(response); },
    fetchStarted() { resolveStarted(); },
  };
}

function capabilitiesResponse(): Response {
  return new Response(JSON.stringify({ success: true, data: {
    protocolVersion: 1,
    user: { id: "target-user", name: "target-user", displayName: null },
    transferLimits: { maxPackageBytes: 1024 },
  } }), { status: 200, headers: { "content-type": "application/json" } });
}

import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getDb, validateApiKey } from "../../src/lib/meta-sqlite.js";
import { createTestUser } from "../helpers/createUser.js";
import { createTestServer, getTestApiKey } from "./helpers.js";

const CONTROL_TOKEN = "notification-control-token-with-128-bits";
const SECRET_CANARY = "notification-source-secret-canary";
const fixtureRoot = path.resolve(process.cwd(), "../../tmp/task-10a-device-notifications");
const activeStops: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (activeStops.length > 0) await activeStops.pop()!();
  await fs.rm(fixtureRoot, { recursive: true, force: true });
});

async function startServer(notificationToken: string | null = CONTROL_TOKEN) {
  await fs.mkdir(fixtureRoot, { recursive: true });
  const server = await createTestServer({
    dataRoot: fixtureRoot,
    env: { LOCALAPP_NOTIFICATION_CONTROL_TOKEN: notificationToken ?? undefined },
  });
  activeStops.push(server.stop);
  return server;
}

function originHeaders(baseUrl: string, auth: Record<string, string> = { "x-api-key": getTestApiKey() }) {
  return { ...auth, origin: baseUrl, "content-type": "application/json" };
}

async function internalSnapshot(
  app: Awaited<ReturnType<typeof startServer>>["app"],
  token = CONTROL_TOKEN,
  remoteAddress = "127.0.0.1",
) {
  return app.inject({
    method: "GET",
    url: "/api/internal/device-notifications/sources",
    headers: { "x-localapp-notification-control": token },
    remoteAddress,
  });
}

describe("device notification source authority", () => {
  it("exposes versioned machine-local display settings and rejects stale updates", async () => {
    const { app, baseUrl } = await startServer();
    const initial = await app.inject({ method: "GET", url: "/api/device-notifications/settings", headers: { "x-api-key": getTestApiKey() } });
    expect(initial.statusCode).toBe(200);
    expect(initial.json()).toEqual({
      success: true,
      data: {
        deviceIntegration: { available: true },
        generation: 0,
        settings: { quietHours: null, preview: "full" },
        native: { permission: "unknown", daemonVersion: null, adapterVersion: null, updatedAt: null },
        lastTest: null,
      },
    });

    const updated = await app.inject({
      method: "PUT", url: "/api/device-notifications/settings", headers: originHeaders(baseUrl),
      payload: { generation: 0, settings: { quietHours: { start: "22:30", end: "07:15", timeZone: "Asia/Tokyo" }, preview: "hidden" } },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().data).toMatchObject({
      generation: 1,
      settings: { quietHours: { start: "22:30", end: "07:15", timeZone: "Asia/Tokyo" }, preview: "hidden" },
    });

    const stale = await app.inject({
      method: "PUT", url: "/api/device-notifications/settings", headers: originHeaders(baseUrl),
      payload: { generation: 0, settings: { quietHours: null, preview: "full" } },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().code).toBe("DEVICE_NOTIFICATION_GENERATION_CONFLICT");
  });

  it("creates, atomically claims, and completes one fixed user-bound test command", async () => {
    const { app, baseUrl } = await startServer();
    const created = await app.inject({
      method: "POST", url: "/api/device-notifications/test", headers: originHeaders(baseUrl), payload: { generation: 0 },
    });
    expect(created.statusCode).toBe(202);
    expect(created.body).not.toContain(getTestApiKey());
    expect(created.json().data).toMatchObject({ generation: 1, test: { id: expect.any(String), state: "pending", result: null } });
    const commandId = created.json().data.test.id as string;

    const claim = await app.inject({
      method: "POST", url: "/api/internal/device-notifications/test/claim",
      headers: { "x-localapp-notification-control": CONTROL_TOKEN },
    });
    expect(claim.statusCode).toBe(200);
    expect(claim.json()).toEqual({ success: true, data: { command: { id: commandId, type: "test-notification", userId: "localadmin" } } });
    const duplicate = await app.inject({
      method: "POST", url: "/api/internal/device-notifications/test/claim",
      headers: { "x-localapp-notification-control": CONTROL_TOKEN },
    });
    expect(duplicate.json()).toEqual({ success: true, data: { command: null } });

    const completed = await app.inject({
      method: "POST", url: `/api/internal/device-notifications/test/${commandId}/complete`,
      headers: { "x-localapp-notification-control": CONTROL_TOKEN, "content-type": "application/json" },
      payload: { result: "shown", permission: "granted", daemonVersion: "0.1.0", adapterVersion: "0.1.0" },
    });
    expect(completed.statusCode).toBe(200);
    const state = await app.inject({ method: "GET", url: "/api/device-notifications/settings", headers: { "x-api-key": getTestApiKey() } });
    expect(state.json().data).toMatchObject({
      native: { permission: "granted", daemonVersion: "0.1.0", adapterVersion: "0.1.0", updatedAt: expect.any(String) },
      lastTest: { id: commandId, state: "completed", result: "shown" },
    });
  });

  it("keeps settings visible but immutable when local device integration is unavailable", async () => {
    const { app, baseUrl } = await startServer(null);
    const state = await app.inject({ method: "GET", url: "/api/device-notifications/settings", headers: { "x-api-key": getTestApiKey() } });
    expect(state.statusCode).toBe(200);
    expect(state.json().data.deviceIntegration).toEqual({ available: false });
    const mutation = await app.inject({
      method: "PUT", url: "/api/device-notifications/settings", headers: originHeaders(baseUrl),
      payload: { generation: 0, settings: { quietHours: null, preview: "hidden" } },
    });
    expect(mutation.statusCode).toBe(409);
    expect(mutation.json().code).toBe("DEVICE_NOTIFICATION_CAPABILITY_UNAVAILABLE");
  });

  it("reports a stable headless capability and keeps mutation routes present", async () => {
    const { app, baseUrl } = await startServer(null);
    const state = await app.inject({ method: "GET", url: "/api/device-notifications", headers: { "x-api-key": getTestApiKey() } });
    expect(state.statusCode).toBe(200);
    expect(state.json()).toEqual({
      success: true,
      data: { deviceIntegration: { available: false }, generation: 0, sources: [] },
    });

    const enabled = await app.inject({
      method: "POST",
      url: "/api/device-notifications/local/enable",
      headers: originHeaders(baseUrl),
      payload: { generation: 0, label: "This Server" },
    });
    expect(enabled.statusCode).toBe(409);
    expect(enabled.json()).toEqual({
      success: false,
      code: "DEVICE_NOTIFICATION_CAPABILITY_UNAVAILABLE",
      error: "Device notification integration is unavailable",
    });
  });

  it("binds local enablement to the authenticated account and is idempotent", async () => {
    const { app, baseUrl } = await startServer();
    const user = await createTestUser(baseUrl, "notify-local-user");
    const headers = originHeaders(baseUrl, { cookie: user.cookie });

    const csrfRejected = await app.inject({
      method: "POST",
      url: "/api/device-notifications/local/enable",
      headers: { cookie: user.cookie, "content-type": "application/json" },
      payload: { generation: 0, label: "Laptop" },
    });
    expect(csrfRejected.statusCode).toBe(403);
    expect(csrfRejected.json().code).toBe("DEVICE_NOTIFICATION_ORIGIN_REQUIRED");

    const first = await app.inject({
      method: "POST",
      url: "/api/device-notifications/local/enable",
      headers,
      payload: { generation: 0, label: "Laptop" },
    });
    expect(first.statusCode).toBe(200);
    const firstBody = first.json();
    expect(firstBody.data.generation).toBe(1);
    expect(firstBody.data.source).toEqual({
      id: expect.any(String),
      kind: "local",
      sourceLabel: "Laptop",
      accountLabel: "notify-local-user",
      desiredEnabled: true,
      capability: { available: true, reason: null },
      connectionState: "pending",
      cursor: null,
      lastEventAt: null,
      error: null,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    expect(first.body).not.toContain(SECRET_CANARY);
    expect(firstBody.data.source).not.toHaveProperty("generation");
    expect(firstBody.data.source).not.toHaveProperty("credential");
    expect(firstBody.data.source).not.toHaveProperty("apiKey");

    const snapshot = await internalSnapshot(app);
    expect(snapshot.statusCode).toBe(200);
    const local = snapshot.json().data.sources[0];
    expect(local).toMatchObject({
      id: firstBody.data.source.id,
      kind: "local",
      generation: 1,
      sourceOrigin: baseUrl,
      targetUserId: "notify-local-user",
      accountLabel: "notify-local-user",
      sourceLabel: "Laptop",
      enabled: true,
      capability: { available: true, reason: null },
      credential: expect.any(String),
    });

    const retried = await app.inject({
      method: "POST",
      url: "/api/device-notifications/local/enable",
      headers,
      payload: { generation: 0, label: "Laptop" },
    });
    expect(retried.statusCode).toBe(200);
    expect(retried.json().data).toEqual(firstBody.data);
    const retrySnapshot = await internalSnapshot(app);
    expect(retrySnapshot.json().data.sources[0].credential).toBe(local.credential);

    const keyOwner = await app.inject({ method: "GET", url: "/api/me", headers: { "x-api-key": local.credential } });
    expect(keyOwner.json().data.id).toBe("notify-local-user");
  });

  it("revokes exactly the source key, generation-checks disable, and re-enables with a fresh key", async () => {
    const { app, baseUrl } = await startServer();
    const user = await createTestUser(baseUrl, "notify-revoke-user");
    const headers = originHeaders(baseUrl, { cookie: user.cookie });
    const first = await app.inject({
      method: "POST", url: "/api/device-notifications/local/enable", headers,
      payload: { generation: 0, label: "Desktop" },
    });
    const sourceId = first.json().data.source.id as string;
    const oldCredential = (await internalSnapshot(app)).json().data.sources[0].credential as string;

    const conflict = await app.inject({
      method: "POST", url: `/api/device-notifications/${sourceId}/disable`, headers,
      payload: { generation: 0 },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().code).toBe("DEVICE_NOTIFICATION_GENERATION_CONFLICT");

    const disabled = await app.inject({
      method: "POST", url: `/api/device-notifications/${sourceId}/disable`, headers,
      payload: { generation: 1 },
    });
    expect(disabled.statusCode).toBe(200);
    expect(disabled.json().data).toMatchObject({ generation: 2, source: { id: sourceId, desiredEnabled: false } });
    expect(validateApiKey(oldCredential)).toBeNull();
    expect((await app.inject({ method: "GET", url: "/api/keys", headers: { "x-api-key": oldCredential } })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/api/me", headers: { "x-api-key": user.apiKey } })).statusCode).toBe(200);

    const repeated = await app.inject({
      method: "POST", url: `/api/device-notifications/${sourceId}/disable`, headers,
      payload: { generation: 1 },
    });
    expect(repeated.statusCode).toBe(200);
    expect(repeated.json().data).toEqual(disabled.json().data);

    const reenabled = await app.inject({
      method: "POST", url: "/api/device-notifications/local/enable", headers,
      payload: { generation: 2, label: "Desktop" },
    });
    expect(reenabled.json().data).toMatchObject({ generation: 3, source: { id: sourceId, desiredEnabled: true } });
    const freshCredential = (await internalSnapshot(app)).json().data.sources[0].credential as string;
    expect(freshCredential).not.toBe(oldCredential);
  });

  it("requires loopback plus the distinct notification token and conditionally accepts bounded status", async () => {
    const { app, baseUrl } = await startServer();
    const enabled = await app.inject({
      method: "POST", url: "/api/device-notifications/local/enable", headers: originHeaders(baseUrl),
      payload: { generation: 0, label: "Local" },
    });
    const sourceId = enabled.json().data.source.id as string;

    expect((await internalSnapshot(app, "wrong-token")).statusCode).toBe(401);
    expect((await internalSnapshot(app, CONTROL_TOKEN, "192.0.2.8")).statusCode).toBe(403);

    const status = await app.inject({
      method: "POST",
      url: `/api/internal/device-notifications/sources/${sourceId}/status`,
      headers: { "x-localapp-notification-control": CONTROL_TOKEN, "content-type": "application/json" },
      payload: { generation: 1, state: "connected", cursor: 17, lastEventAt: "2026-08-12T03:04:05.000Z", error: null },
    });
    expect(status.statusCode).toBe(200);
    const publicState = await app.inject({ method: "GET", url: `/api/device-notifications/${sourceId}`, headers: { "x-api-key": getTestApiKey() } });
    expect(publicState.json().data.source).toMatchObject({
      connectionState: "connected",
      cursor: 17,
      lastEventAt: "2026-08-12T03:04:05.000Z",
    });

    const redactedError = await app.inject({
      method: "POST",
      url: `/api/internal/device-notifications/sources/${sourceId}/status`,
      headers: { "x-localapp-notification-control": CONTROL_TOKEN, "content-type": "application/json" },
      payload: { generation: 1, state: "error", cursor: 17, lastEventAt: null, error: { code: "SOURCE_AUTH_FAILED", message: SECRET_CANARY } },
    });
    expect(redactedError.statusCode).toBe(200);
    expect(redactedError.body).not.toContain(SECRET_CANARY);
    expect(redactedError.json().data.source.error).toEqual({
      code: "SOURCE_AUTH_FAILED",
      message: "Notification source reported an error",
    });

    const malformed = await app.inject({
      method: "POST",
      url: `/api/internal/device-notifications/sources/${sourceId}/status`,
      headers: { "x-localapp-notification-control": CONTROL_TOKEN, "content-type": "application/json" },
      payload: `{"generation":1,"state":"${SECRET_CANARY}`,
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.body).not.toContain(SECRET_CANARY);

    const duplicateField = await app.inject({
      method: "POST",
      url: `/api/internal/device-notifications/sources/${sourceId}/status`,
      headers: { "x-localapp-notification-control": CONTROL_TOKEN, "content-type": "application/json" },
      payload: '{"generation":1,"generation":1,"state":"connected","cursor":17,"lastEventAt":null,"error":null}',
    });
    expect(duplicateField.statusCode).toBe(400);
    expect(duplicateField.json()).toEqual({
      success: false,
      code: "DEVICE_NOTIFICATION_INVALID_STATUS",
      error: "Invalid notification status report",
    });

    const otherUser = await createTestUser(baseUrl, "notify-unrelated-user");
    const otherEnabled = await app.inject({
      method: "POST", url: "/api/device-notifications/local/enable",
      headers: originHeaders(baseUrl, { cookie: otherUser.cookie }),
      payload: { generation: 1, label: "Other source" },
    });
    expect(otherEnabled.statusCode).toBe(200);
    const unaffectedStatus = await app.inject({
      method: "POST",
      url: `/api/internal/device-notifications/sources/${sourceId}/status`,
      headers: { "x-localapp-notification-control": CONTROL_TOKEN, "content-type": "application/json" },
      payload: { generation: 1, state: "connected", cursor: 18, lastEventAt: null, error: null },
    });
    expect(unaffectedStatus.statusCode).toBe(200);

    await app.inject({
      method: "POST", url: `/api/device-notifications/${sourceId}/disable`, headers: originHeaders(baseUrl), payload: { generation: 2 },
    });
    const stale = await app.inject({
      method: "POST",
      url: `/api/internal/device-notifications/sources/${sourceId}/status`,
      headers: { "x-localapp-notification-control": CONTROL_TOKEN, "content-type": "application/json" },
      payload: { generation: 1, state: "error", cursor: 18, lastEventAt: null, error: { code: "STALE_SECRET", message: SECRET_CANARY } },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.body).not.toContain(SECRET_CANARY);
  });

  it("enables only verified peers and invalidates them on rotation or deletion without copying credentials", async () => {
    const { app, baseUrl, dataDir } = await startServer();
    const created = await app.inject({
      method: "POST", url: "/api/peers", headers: originHeaders(baseUrl),
      payload: { name: "remote", baseUrl, apiKey: getTestApiKey(), acceptInsecureHttp: true },
    });
    const peerId = created.json().data.id as string;
    const unverified = await app.inject({
      method: "POST", url: `/api/device-notifications/peers/${peerId}/enable`, headers: originHeaders(baseUrl),
      payload: { generation: 0, label: "Remote Server" },
    });
    expect(unverified.statusCode).toBe(409);
    expect(unverified.body).not.toContain(getTestApiKey());

    const checked = await app.inject({ method: "POST", url: `/api/peers/${peerId}/check`, headers: { "x-api-key": getTestApiKey() } });
    expect(checked.statusCode, checked.body).toBe(200);
    const enabled = await app.inject({
      method: "POST", url: `/api/device-notifications/peers/${peerId}/enable`, headers: originHeaders(baseUrl),
      payload: { generation: 0, label: "Remote Server" },
    });
    expect(enabled.statusCode).toBe(200);
    const sourceId = enabled.json().data.source.id as string;
    expect(enabled.body).not.toContain(getTestApiKey());
    const sourceRow = getDb().exec(`SELECT encrypted_credential FROM device_notification_sources WHERE id = '${sourceId}'`)[0]?.values[0];
    expect(sourceRow).toEqual([[null]][0]);
    const snapshot = await internalSnapshot(app);
    expect(snapshot.json().data.sources[0]).toMatchObject({
      kind: "peer", sourceOrigin: baseUrl, targetUserId: "localadmin", credential: getTestApiKey(),
    });

    const rotated = await app.inject({
      method: "PATCH", url: `/api/peers/${peerId}`, headers: originHeaders(baseUrl),
      payload: { apiKey: "rotated-peer-secret" },
    });
    expect(rotated.statusCode).toBe(200);
    const afterRotation = await app.inject({ method: "GET", url: "/api/device-notifications", headers: { "x-api-key": getTestApiKey() } });
    expect(afterRotation.json().data).toMatchObject({
      generation: 2,
      sources: [expect.objectContaining({ id: sourceId, desiredEnabled: false, capability: { available: false, reason: "PEER_CONFIGURATION_CHANGED" } })],
    });

    expect((await app.inject({ method: "DELETE", url: `/api/peers/${peerId}`, headers: { "x-api-key": getTestApiKey() } })).statusCode).toBe(204);
    const afterDelete = await app.inject({ method: "GET", url: "/api/device-notifications", headers: { "x-api-key": getTestApiKey() } });
    expect(afterDelete.json().data).toMatchObject({
      generation: 3,
      sources: [expect.objectContaining({ id: sourceId, desiredEnabled: false, capability: { available: false, reason: "PEER_DELETED" } })],
    });
    expect((await fs.readFile(path.join(dataDir, "meta.sqlite"))).includes(Buffer.from("rotated-peer-secret"))).toBe(false);
  });

  it("keeps one stable peer source for a target account across equivalent verified peers", async () => {
    const { app, baseUrl } = await startServer();
    const secondKeyResponse = await app.inject({
      method: "POST",
      url: "/api/keys",
      headers: { "x-api-key": getTestApiKey(), "content-type": "application/json" },
      payload: { userId: "localadmin" },
    });
    expect(secondKeyResponse.statusCode).toBe(200);
    const secondKey = secondKeyResponse.json().data.key as string;
    const peerOrigins = [baseUrl, baseUrl.replace("127.0.0.1", "localhost")];
    const peerCredentials = [getTestApiKey(), secondKey];
    const peerIds: string[] = [];
    for (const [index, name] of ["remote-one", "remote-two"].entries()) {
      const created = await app.inject({
        method: "POST", url: "/api/peers", headers: originHeaders(baseUrl),
        payload: { name, baseUrl: peerOrigins[index], apiKey: peerCredentials[index], acceptInsecureHttp: true },
      });
      expect(created.statusCode).toBe(201);
      const peerId = created.json().data.id as string;
      peerIds.push(peerId);
      expect((await app.inject({
        method: "POST", url: `/api/peers/${peerId}/check`, headers: { "x-api-key": getTestApiKey() },
      })).statusCode).toBe(200);
    }

    const first = await app.inject({
      method: "POST", url: `/api/device-notifications/peers/${peerIds[0]}/enable`, headers: originHeaders(baseUrl),
      payload: { generation: 0, label: "Remote one" },
    });
    expect(first.statusCode).toBe(200);
    const firstId = first.json().data.source.id as string;

    const second = await app.inject({
      method: "POST", url: `/api/device-notifications/peers/${peerIds[1]}/enable`, headers: originHeaders(baseUrl),
      payload: { generation: 1, label: "Remote two" },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().data).toMatchObject({ generation: 2, source: { id: firstId, sourceLabel: "Remote two" } });
    expect((await internalSnapshot(app)).json().data.sources).toEqual([
      expect.objectContaining({
        id: firstId,
        kind: "peer",
        sourceLabel: "Remote two",
        sourceOrigin: peerOrigins[1],
        credential: secondKey,
      }),
    ]);

    getDb().run("UPDATE peers SET connection_version = connection_version + 1 WHERE id = ?", [peerIds[0]]);
    expect((await app.inject({
      method: "GET", url: "/api/device-notifications", headers: { "x-api-key": getTestApiKey() },
    })).json().data).toMatchObject({
      generation: 2,
      sources: [expect.objectContaining({ id: firstId, desiredEnabled: true })],
    });

    getDb().run("UPDATE peers SET connection_version = connection_version + 1 WHERE id = ?", [peerIds[1]]);
    expect((await app.inject({
      method: "GET", url: "/api/device-notifications", headers: { "x-api-key": getTestApiKey() },
    })).json().data).toMatchObject({
      generation: 3,
      sources: [expect.objectContaining({ id: firstId, desiredEnabled: false })],
    });
  });

  it.each([
    ["base_url", "UPDATE peers SET base_url = 'https://changed.invalid' WHERE id = ?"],
    ["credential", "UPDATE peers SET credential = 'changed-ciphertext' WHERE id = ?"],
    ["accept_insecure_http", "UPDATE peers SET accept_insecure_http = 0 WHERE id = ?"],
    ["connection_version", "UPDATE peers SET connection_version = connection_version + 1 WHERE id = ?"],
    ["verified_user_id", "UPDATE peers SET verified_user_id = NULL WHERE id = ?"],
    ["verified_user_name", "UPDATE peers SET verified_user_name = NULL WHERE id = ?"],
    ["verified_at", "UPDATE peers SET verified_at = NULL WHERE id = ?"],
  ])("invalidates an enabled peer source when %s changes directly with null-safe comparison", async (_field, mutation) => {
    const { app, baseUrl } = await startServer();
    const created = await app.inject({
      method: "POST", url: "/api/peers", headers: originHeaders(baseUrl),
      payload: { name: "direct-mutation-peer", baseUrl, apiKey: getTestApiKey(), acceptInsecureHttp: true },
    });
    const peerId = created.json().data.id as string;
    expect((await app.inject({
      method: "POST", url: `/api/peers/${peerId}/check`, headers: { "x-api-key": getTestApiKey() },
    })).statusCode).toBe(200);
    expect((await app.inject({
      method: "POST", url: `/api/device-notifications/peers/${peerId}/enable`, headers: originHeaders(baseUrl),
      payload: { generation: 0, label: "Direct mutation peer" },
    })).statusCode).toBe(200);

    getDb().run(mutation, [peerId]);

    expect((await app.inject({
      method: "GET", url: "/api/device-notifications", headers: { "x-api-key": getTestApiKey() },
    })).json().data).toMatchObject({
      generation: 2,
      sources: [expect.objectContaining({
        desiredEnabled: false,
        capability: { available: false, reason: "PEER_CONFIGURATION_CHANGED" },
      })],
    });
  });

  it("isolates a corrupt local credential and removes a deleted user's source and exact key", async () => {
    const { app, baseUrl } = await startServer();
    const user = await createTestUser(baseUrl, "notify-delete-user");
    const enabled = await app.inject({
      method: "POST", url: "/api/device-notifications/local/enable",
      headers: originHeaders(baseUrl, { cookie: user.cookie }), payload: { generation: 0, label: "Delete me" },
    });
    const sourceId = enabled.json().data.source.id as string;
    const credential = (await internalSnapshot(app)).json().data.sources[0].credential as string;
    const healthy = await app.inject({
      method: "POST", url: "/api/device-notifications/local/enable",
      headers: originHeaders(baseUrl), payload: { generation: 1, label: "Healthy admin" },
    });
    expect(healthy.statusCode).toBe(200);
    getDb().run("UPDATE device_notification_sources SET encrypted_credential = ? WHERE id = ?", ["corrupt-secret-canary", sourceId]);

    const publicCorrupt = await app.inject({
      method: "GET", url: `/api/device-notifications/${sourceId}`, headers: { cookie: user.cookie },
    });
    expect(publicCorrupt.json().data.source.capability).toEqual({ available: false, reason: "SOURCE_CREDENTIAL_INVALID" });

    const isolated = await internalSnapshot(app);
    expect(isolated.statusCode).toBe(200);
    expect(isolated.body).not.toContain("corrupt-secret-canary");
    expect(isolated.json().data.sources.find((source: { id: string }) => source.id === sourceId)).toMatchObject({
      id: sourceId,
      enabled: false,
      capability: { available: false, reason: "SOURCE_CREDENTIAL_INVALID" },
    });
    expect(isolated.json().data.sources.find((source: { id: string }) => source.id === sourceId)).not.toHaveProperty("credential");
    expect(isolated.json().data.sources.find((source: { id: string }) => source.id === healthy.json().data.source.id)).toMatchObject({
      enabled: true,
      capability: { available: true, reason: null },
      credential: expect.any(String),
    });

    const deleted = await app.inject({ method: "DELETE", url: "/api/admin/users/notify-delete-user", headers: { "x-api-key": getTestApiKey() } });
    expect(deleted.statusCode).toBe(200);
    expect((await internalSnapshot(app)).json().data.sources).toEqual([
      expect.objectContaining({ id: healthy.json().data.source.id, enabled: true }),
    ]);
    expect((await app.inject({ method: "GET", url: "/api/keys", headers: { "x-api-key": credential } })).statusCode).toBe(401);
  });
});

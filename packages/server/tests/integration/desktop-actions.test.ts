import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import WebSocket from "ws";
import { getDb } from "../../src/lib/meta-sqlite.js";
import { readPageMeta, writePageMeta } from "../../src/plugins/storage.js";
import { createTestUser } from "../helpers/createUser.js";
import { createTestPage, createTestServer, getAppUrl } from "./helpers.js";

type CreatedAction = {
  requestId: string;
  activationUrl: string;
  expiresAt: string;
  protocolVersion: number;
};

describe("desktop action HTTP bridge", () => {
  let app: FastifyInstance;
  let baseUrl: string;
  let stop: () => Promise<void>;
  let runner: Awaited<ReturnType<typeof createTestUser>>;
  let other: Awaited<ReturnType<typeof createTestUser>>;
  let owner: Awaited<ReturnType<typeof createTestUser>>;
  let dataDir: string;
  const streamControllers = new Set<AbortController>();

  beforeAll(async () => {
    const server = await createTestServer({ websocket: true });
    app = server.app;
    baseUrl = getAppUrl(app);
    stop = server.stop;
    dataDir = server.dataDir;

    runner = await createTestUser(baseUrl, "actionrunner");
    other = await createTestUser(baseUrl, "actionother");
    owner = await createTestUser(baseUrl, "actionowner");
    await createTestPage(app, "actionowner", "automation");

    const meta = readPageMeta(server.dataDir, "actionowner", "automation")!;
    meta.versions[0].uploaderId = "release-publisher";
    meta.versions[0].uploaderDisplayName = "Release Publisher";
    writePageMeta(server.dataDir, "actionowner", "automation", meta);
  });

  afterAll(async () => {
    await stop();
  });

  afterEach(() => {
    for (const controller of streamControllers) controller.abort();
    streamControllers.clear();
  });

  async function createAction(
    body: Record<string, unknown> = {},
    options: { cookie?: string; apiKey?: string; referer?: string } = {},
  ): Promise<{ response: Response; data?: CreatedAction; json: any }> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      referer: options.referer ?? `${baseUrl}/actionowner/automation/`,
    };
    if (options.apiKey) headers["X-API-Key"] = options.apiKey;
    else headers.cookie = options.cookie ?? runner.cookie;
    const response = await fetch(`${baseUrl}/serve/actionowner/automation/api/desktop-actions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        title: "Generate report",
        description: "Build the local workbook",
        script: "return { ok: true }",
        dependencies: { zod: "3.23.8" },
        input: { month: "2026-07" },
        timeoutSeconds: 45,
        ...body,
      }),
    });
    const json = await response.json();
    return { response, data: json.data, json };
  }

  function activationParts(created: CreatedAction): { nonce: string } {
    const url = new URL(created.activationUrl);
    return { nonce: url.searchParams.get("nonce") ?? "" };
  }

  async function waitFor(check: () => boolean, timeoutMs = 2_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!check()) {
      if (Date.now() >= deadline) throw new Error("Timed out waiting for desktop action event");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  async function openDesktopSocket(apiKey: string): Promise<{ socket: WebSocket; messages: any[] }> {
    const messages: any[] = [];
    const wsUrl = `${baseUrl.replace(/^http/, "ws")}/api/ws?client=desktop&protocolVersion=1&installationId=desktop-live`;
    const socket = new WebSocket(wsUrl, { headers: { Authorization: `Bearer ${apiKey}` } });
    socket.on("message", (raw) => messages.push(JSON.parse(raw.toString())));
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    await waitFor(() => messages.some((message) => message.type === "bus:ready"));
    return { socket, messages };
  }

  function streamController(): AbortController {
    const controller = new AbortController();
    streamControllers.add(controller);
    return controller;
  }

  it("creates a scoped action with server-derived user, app version, and publisher", async () => {
    const { response, data } = await createAction({
      userId: "forged-user",
      appOwner: "forged-owner",
      appName: "forged-app",
      appVersion: "999",
      publisherUserId: "forged-publisher",
    });

    expect(response.status).toBe(201);
    expect(data).toMatchObject({
      requestId: expect.any(String),
      activationUrl: expect.stringMatching(/^localapp:\/\/action\//),
      expiresAt: expect.any(String),
      protocolVersion: 1,
    });

    const { nonce } = activationParts(data!);
    const claim = await fetch(
      `${baseUrl}/api/desktop-actions/${data!.requestId}/claim?nonce=${encodeURIComponent(nonce)}&installationId=desktop-a&protocolVersion=1`,
      { headers: { "X-API-Key": runner.apiKey } },
    );
    expect(claim.status).toBe(200);
    expect(await claim.json()).toMatchObject({
      success: true,
      data: {
        id: data!.requestId,
        userId: "actionrunner",
        serverOrigin: baseUrl,
        appOwner: "actionowner",
        appName: "automation",
        appVersion: "1",
        publisherUserId: "release-publisher",
        publisherDisplayName: "Release Publisher",
        script: "return { ok: true }",
        dependencies: { zod: "3.23.8" },
        input: { month: "2026-07" },
      },
    });
  });

  it("uses the validated Referer origin instead of the internal request scheme", async () => {
    const externalOrigin = `https://${new URL(baseUrl).host}`;
    const { response, data } = await createAction({}, {
      referer: `${externalOrigin}/actionowner/automation/`,
    });
    expect(response.status).toBe(201);

    const nonce = activationParts(data!).nonce;
    const claim = await fetch(
      `${baseUrl}/api/desktop-actions/${data!.requestId}/claim?nonce=${nonce}&installationId=desktop-origin&protocolVersion=1`,
      { headers: { "X-API-Key": runner.apiKey } },
    );
    expect((await claim.json()).data.serverOrigin).toBe(externalOrigin);
  });

  it("attributes owner API-key creation to an owner-bound dev version", async () => {
    const { response, data } = await createAction({}, { apiKey: owner.apiKey });
    expect(response.status).toBe(201);

    const nonce = activationParts(data!).nonce;
    const claim = await fetch(
      `${baseUrl}/api/desktop-actions/${data!.requestId}/claim?nonce=${nonce}&installationId=desktop-dev&protocolVersion=1`,
      { headers: { "X-API-Key": owner.apiKey } },
    );
    expect(claim.status).toBe(200);
    expect((await claim.json()).data).toMatchObject({
      userId: "actionowner",
      appOwner: "actionowner",
      appName: "automation",
      appVersion: "dev",
      publisherUserId: "actionowner",
    });
  });

  it("rejects an unrelated API key even when the target app is public", async () => {
    const { response, json } = await createAction({}, { apiKey: other.apiKey });
    expect(response.status).toBe(403);
    expect(json).toMatchObject({
      success: false,
      code: "DESKTOP_ACTION_APP_OWNER_REQUIRED",
    });
  });

  it("allows an owner API key to create in an owner-only app and rejects unrelated API keys", async () => {
    const meta = readPageMeta(dataDir, "actionowner", "automation")!;
    meta.pageAccess = { level: "owner" };
    writePageMeta(dataDir, "actionowner", "automation", meta);
    try {
      const ownerCreate = await createAction({}, { apiKey: owner.apiKey });
      expect(ownerCreate.response.status).toBe(201);

      const unrelatedCreate = await createAction({}, { apiKey: other.apiKey });
      expect(unrelatedCreate.response.status).toBe(403);

      const ordinaryApi = await fetch(`${baseUrl}/serve/actionowner/automation/api/time`, {
        headers: { "X-API-Key": owner.apiKey },
      });
      expect(ordinaryApi.status).toBe(401);
    } finally {
      const restored = readPageMeta(dataDir, "actionowner", "automation")!;
      delete restored.pageAccess;
      writePageMeta(dataDir, "actionowner", "automation", restored);
    }
  });

  it.each([
    ["missing-auth", "valid"],
    ["authenticated", "missing"],
    ["authenticated", "wrong-app"],
    ["authenticated", "wrong-origin"],
  ])("rejects missing auth and spoofed Referer values", async (authCase, refererCase) => {
    const cookie = authCase === "authenticated" ? runner.cookie : "";
    const referer = {
      valid: `${baseUrl}/actionowner/automation/`,
      missing: "",
      "wrong-app": `${baseUrl}/actionowner/different-app/`,
      "wrong-origin": "https://attacker.example/actionowner/automation/",
    }[refererCase];
    const { response } = await createAction({}, { cookie, referer });
    expect([401, 403]).toContain(response.status);
  });

  it.each([
    [{ script: `${"a".repeat(256 * 1024 - 1)}🙂` }, "DESKTOP_ACTION_SCRIPT_TOO_LARGE"],
    [{ input: { value: "a".repeat(1024 * 1024) } }, "DESKTOP_ACTION_INPUT_TOO_LARGE"],
    [{ dependencies: { package: "^1.0.0" } }, "DESKTOP_ACTION_INVALID_DEPENDENCY"],
    [{ timeoutSeconds: 0 }, "DESKTOP_ACTION_INVALID_TIMEOUT"],
  ])("maps repository payload validation to stable 400 errors", async (body, code) => {
    const { response, json } = await createAction(body);
    expect(response.status).toBe(400);
    expect(json).toMatchObject({ success: false, code });
  });

  it("isolates public snapshots and redacts executable and claim secrets", async () => {
    const { data } = await createAction();

    const own = await fetch(`${baseUrl}/api/desktop-actions/${data!.requestId}`, {
      headers: { cookie: runner.cookie },
    });
    expect(own.status).toBe(200);
    const ownBody = await own.json();
    expect(ownBody.data).toMatchObject({ id: data!.requestId, userId: "actionrunner", status: "pending" });
    for (const secret of ["script", "dependencies", "input", "nonce", "installationId"]) {
      expect(ownBody.data).not.toHaveProperty(secret);
    }

    const otherRead = await fetch(`${baseUrl}/api/desktop-actions/${data!.requestId}`, {
      headers: { "X-API-Key": other.apiKey },
    });
    expect(otherRead.status).toBe(404);
  });

  it("requires API keys for recovery and claim, hides bad nonces and cross-user IDs alike, and binds one installation", async () => {
    const first = (await createAction()).data!;
    const second = (await createAction()).data!;
    const firstNonce = activationParts(first).nonce;

    const pendingWithCookie = await fetch(`${baseUrl}/api/desktop-actions/pending`, {
      headers: { cookie: runner.cookie },
    });
    expect(pendingWithCookie.status).toBe(401);

    const pending = await fetch(`${baseUrl}/api/desktop-actions/pending`, {
      headers: { "X-API-Key": runner.apiKey },
    });
    expect(pending.status).toBe(200);
    expect((await pending.json()).data.map((item: { id: string }) => item.id)).toEqual(
      expect.arrayContaining([first.requestId, second.requestId]),
    );

    const wrongNonce = await fetch(
      `${baseUrl}/api/desktop-actions/${first.requestId}/claim?nonce=wrong&installationId=desktop-a&protocolVersion=1`,
      { headers: { "X-API-Key": runner.apiKey } },
    );
    const crossUser = await fetch(
      `${baseUrl}/api/desktop-actions/${first.requestId}/claim?nonce=${firstNonce}&installationId=desktop-a&protocolVersion=1`,
      { headers: { "X-API-Key": other.apiKey } },
    );
    expect(wrongNonce.status).toBe(404);
    expect(await wrongNonce.json()).toEqual(await crossUser.json());

    const claimUrl = `${baseUrl}/api/desktop-actions/${first.requestId}/claim?nonce=${firstNonce}&protocolVersion=1`;
    const [winner, loser] = await Promise.all([
      fetch(`${claimUrl}&installationId=desktop-a`, { headers: { "X-API-Key": runner.apiKey } }),
      fetch(`${claimUrl}&installationId=desktop-b`, { headers: { "X-API-Key": runner.apiKey } }),
    ]);
    expect([winner.status, loser.status].sort()).toEqual([200, 409]);
  });

  it("recovers only this user's executable in-flight records for the exact installation", async () => {
    const installationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const otherInstallationId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const created = await Promise.all(Array.from({ length: 6 }, () => createAction()));
    const actions = created.map(({ data }) => data!);

    for (const action of actions.slice(0, 5)) {
      const nonce = activationParts(action).nonce;
      const claim = await fetch(
        `${baseUrl}/api/desktop-actions/${action.requestId}/claim?nonce=${nonce}&installationId=${installationId}&protocolVersion=1`,
        { headers: { "X-API-Key": runner.apiKey } },
      );
      expect(claim.status).toBe(200);
    }
    const update = (action: CreatedAction, status: string) =>
      fetch(`${baseUrl}/api/desktop-actions/${action.requestId}/status`, {
        method: "POST",
        headers: { "X-API-Key": runner.apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ installationId, status }),
      });
    await update(actions[1], "awaiting_trust");
    await update(actions[2], "preparing");
    await update(actions[3], "preparing");
    await update(actions[3], "running");
    await update(actions[4], "preparing");
    await update(actions[4], "failed");

    const cookieOnly = await fetch(
      `${baseUrl}/api/desktop-actions/recover?installationId=${installationId}`,
      { headers: { cookie: runner.cookie } },
    );
    expect(cookieOnly.status).toBe(401);
    expect(cookieOnly.headers.get("cache-control")).toBe("no-store");

    const missingInstallation = await fetch(`${baseUrl}/api/desktop-actions/recover`, {
      headers: { "X-API-Key": runner.apiKey },
    });
    expect(missingInstallation.status).toBe(400);
    const nonCanonicalInstallation = await fetch(
      `${baseUrl}/api/desktop-actions/recover?installationId=AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA`,
      { headers: { "X-API-Key": runner.apiKey } },
    );
    expect(nonCanonicalInstallation.status).toBe(400);

    const recovery = await fetch(
      `${baseUrl}/api/desktop-actions/recover?installationId=${installationId}`,
      { headers: { "X-API-Key": runner.apiKey } },
    );
    expect(recovery.status).toBe(200);
    expect(recovery.headers.get("cache-control")).toBe("no-store");
    const recovered = (await recovery.json()).data as Array<Record<string, unknown>>;
    expect(recovered.map(({ id }) => id).sort()).toEqual(actions.slice(0, 4).map(({ requestId }) => requestId).sort());
    expect(recovered).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: actions[3].requestId,
        status: "running",
        script: "return { ok: true }",
        dependencies: { zod: "3.23.8" },
        input: { month: "2026-07" },
      }),
    ]));
    for (const action of recovered) {
      expect(action).not.toHaveProperty("nonce");
      expect(action).not.toHaveProperty("installationId");
    }

    const crossUser = await fetch(
      `${baseUrl}/api/desktop-actions/recover?installationId=${installationId}`,
      { headers: { "X-API-Key": other.apiKey } },
    );
    expect((await crossUser.json()).data).toEqual([]);
    const crossInstallation = await fetch(
      `${baseUrl}/api/desktop-actions/recover?installationId=${otherInstallationId}`,
      { headers: { "X-API-Key": runner.apiKey } },
    );
    expect((await crossInstallation.json()).data).toEqual([]);
  });

  it("expires stale pending actions and rejects unsupported protocol or oversized IDs", async () => {
    const { data } = await createAction();
    const nonce = activationParts(data!).nonce;
    getDb().run(
      "UPDATE desktop_actions SET expires_at = ? WHERE id = ?",
      [new Date(Date.now() - 1_000).toISOString(), data!.requestId],
    );

    const expired = await fetch(
      `${baseUrl}/api/desktop-actions/${data!.requestId}/claim?nonce=${nonce}&installationId=desktop-a&protocolVersion=1`,
      { headers: { "X-API-Key": runner.apiKey } },
    );
    expect(expired.status).toBe(410);
    expect(await expired.json()).toMatchObject({ code: "DESKTOP_ACTION_EXPIRED" });

    const snapshot = await fetch(`${baseUrl}/api/desktop-actions/${data!.requestId}`, {
      headers: { cookie: runner.cookie },
    });
    expect((await snapshot.json()).data.status).toBe("expired");
    const pending = await fetch(`${baseUrl}/api/desktop-actions/pending`, {
      headers: { "X-API-Key": runner.apiKey },
    });
    expect((await pending.json()).data).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: data!.requestId })]),
    );

    const unsupported = await fetch(
      `${baseUrl}/api/desktop-actions/${data!.requestId}/claim?nonce=${nonce}&installationId=desktop-a&protocolVersion=2`,
      { headers: { "X-API-Key": runner.apiKey } },
    );
    expect(unsupported.status).toBe(400);

    const oversized = await fetch(
      `${baseUrl}/api/desktop-actions/${"a".repeat(80)}/claim?nonce=${nonce}&installationId=desktop-a&protocolVersion=1`,
      { headers: { "X-API-Key": runner.apiKey } },
    );
    expect(oversized.status).toBe(400);
  });

  it("enforces installation-bound transitions, stable conflicts, and idempotent terminal retries", async () => {
    const { data } = await createAction();
    const nonce = activationParts(data!).nonce;
    await fetch(
      `${baseUrl}/api/desktop-actions/${data!.requestId}/claim?nonce=${nonce}&installationId=desktop-a&protocolVersion=1`,
      { headers: { "X-API-Key": runner.apiKey } },
    );

    const update = (installationId: string, status: string, extra: Record<string, unknown> = {}) =>
      fetch(`${baseUrl}/api/desktop-actions/${data!.requestId}/status`, {
        method: "POST",
        headers: { "X-API-Key": runner.apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ installationId, status, ...extra }),
      });

    expect((await update("desktop-b", "preparing")).status).toBe(404);
    const invalid = await update("desktop-a", "running");
    expect(invalid.status).toBe(409);
    expect(await invalid.json()).toMatchObject({ code: "DESKTOP_ACTION_INVALID_TRANSITION" });

    expect((await update("desktop-a", "preparing")).status).toBe(200);
    expect((await update("desktop-a", "running")).status).toBe(200);
    const terminal = await update("desktop-a", "succeeded", { result: { value: 42 } });
    expect(terminal.status).toBe(200);
    expect((await terminal.json()).data).toMatchObject({ status: "succeeded", result: { value: 42 } });

    const retry = await update("desktop-a", "succeeded", { result: { value: 99 } });
    expect(retry.status).toBe(200);
    expect((await retry.json()).data.result).toEqual({ value: 42 });

    const conflict = await update("desktop-a", "failed", { error: { message: "late" } });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ code: "DESKTOP_ACTION_TERMINAL_CONFLICT" });
  });

  it("accepts an exact 1 MiB result through the status HTTP envelope", async () => {
    const { data } = await createAction();
    const nonce = activationParts(data!).nonce;
    await fetch(
      `${baseUrl}/api/desktop-actions/${data!.requestId}/claim?nonce=${nonce}&installationId=desktop-result&protocolVersion=1`,
      { headers: { "X-API-Key": runner.apiKey } },
    );

    const update = (status: string, extra: Record<string, unknown> = {}) =>
      fetch(`${baseUrl}/api/desktop-actions/${data!.requestId}/status`, {
        method: "POST",
        headers: { "X-API-Key": runner.apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ installationId: "desktop-result", status, ...extra }),
      });
    expect((await update("preparing")).status).toBe(200);
    expect((await update("running")).status).toBe(200);

    const result = "a".repeat(1024 * 1024 - 2);
    expect(Buffer.byteLength(JSON.stringify(result), "utf8")).toBe(1024 * 1024);
    const terminal = await update("succeeded", { result });
    expect(terminal.status).toBe(200);
    expect((await terminal.json()).data.result).toBe(result);
  });

  it("bounds the complete multibyte error summary and its code", async () => {
    const { data } = await createAction();
    const nonce = activationParts(data!).nonce;
    await fetch(
      `${baseUrl}/api/desktop-actions/${data!.requestId}/claim?nonce=${nonce}&installationId=desktop-error&protocolVersion=1`,
      { headers: { "X-API-Key": runner.apiKey } },
    );
    await fetch(`${baseUrl}/api/desktop-actions/${data!.requestId}/status`, {
      method: "POST",
      headers: { "X-API-Key": runner.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ installationId: "desktop-error", status: "preparing" }),
    });

    const terminal = await fetch(`${baseUrl}/api/desktop-actions/${data!.requestId}/status`, {
      method: "POST",
      headers: { "X-API-Key": runner.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        installationId: "desktop-error",
        status: "failed",
        error: {
          code: "错误".repeat(10_000),
          message: "🙂".repeat(20_000),
        },
      }),
    });
    expect(terminal.status).toBe(200);
    const summary = (await terminal.json()).data.error as { message: string; code: string };
    expect(Buffer.byteLength(JSON.stringify(summary), "utf8")).toBeLessThanOrEqual(64 * 1024);
    expect(Buffer.byteLength(summary.code, "utf8")).toBeLessThanOrEqual(256);
    expect(summary.message).not.toContain("�");
    expect(summary.code).not.toContain("�");
  });

  it("streams redacted snapshots, replays current state, and emits only changed states", async () => {
    const { data } = await createAction();
    const nonce = activationParts(data!).nonce;
    const abort = streamController();
    const stream = await fetch(`${baseUrl}/api/desktop-actions/${data!.requestId}/events`, {
      headers: { cookie: runner.cookie },
      signal: abort.signal,
    });
    expect(stream.status).toBe(200);
    expect(stream.headers.get("cache-control")).toContain("no-store");

    const frames: string[] = [];
    const reader = stream.body!.getReader();
    const decoder = new TextDecoder();
    let buffered = "";
    const reading = (async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) return;
          buffered += decoder.decode(value, { stream: true });
          let boundary = buffered.indexOf("\n\n");
          while (boundary >= 0) {
            frames.push(buffered.slice(0, boundary));
            buffered = buffered.slice(boundary + 2);
            boundary = buffered.indexOf("\n\n");
          }
        }
      } catch (err) {
        if (!abort.signal.aborted) throw err;
      }
    })();

    await waitFor(() => frames.length === 1);
    expect(frames[0]).toContain("event: desktop:action-updated");
    expect(frames[0]).toContain('"status":"pending"');
    const initialData = JSON.parse(frames[0].split("\ndata: ")[1]);
    expect(initialData).toMatchObject({ id: data!.requestId, status: "pending" });
    expect(initialData).not.toHaveProperty("type");
    expect(initialData).not.toHaveProperty("data");
    for (const secret of ["script", "dependencies", "input", "nonce", "installationId"]) {
      expect(frames[0]).not.toContain(`\"${secret}\"`);
    }

    const claim = await fetch(
      `${baseUrl}/api/desktop-actions/${data!.requestId}/claim?nonce=${nonce}&installationId=desktop-a&protocolVersion=1`,
      { headers: { "X-API-Key": runner.apiKey } },
    );
    expect(claim.headers.get("cache-control")).toBe("no-store");
    await waitFor(() => frames.length === 2);

    const update = (status: string) => fetch(`${baseUrl}/api/desktop-actions/${data!.requestId}/status`, {
      method: "POST",
      headers: { "X-API-Key": runner.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ installationId: "desktop-a", status }),
    });
    await update("preparing");
    await waitFor(() => frames.length === 3);
    await update("preparing");
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(frames).toHaveLength(3);

    abort.abort();
    await reading;

    const replayAbort = streamController();
    const replay = await fetch(`${baseUrl}/api/desktop-actions/${data!.requestId}/events`, {
      headers: { cookie: runner.cookie, "Last-Event-ID": "stale-event" },
      signal: replayAbort.signal,
    });
    const replayText = await replay.body!.getReader().read();
    replayAbort.abort();
    expect(decoder.decode(replayText.value)).toContain('"status":"preparing"');
  });

  it("reports same-user live capability and publishes the exact activation event", async () => {
    const runnerCapability = await fetch(`${baseUrl}/api/desktop-actions/capabilities`, {
      headers: { cookie: runner.cookie },
    });
    expect(runnerCapability.status).toBe(200);
    expect(await runnerCapability.json()).toEqual({
      success: true,
      data: { supported: true, online: false, protocolVersion: 1 },
    });

    const { socket, messages } = await openDesktopSocket(runner.apiKey);
    const onlineCapability = await fetch(`${baseUrl}/api/desktop-actions/capabilities`, {
      headers: { cookie: runner.cookie },
    });
    expect((await onlineCapability.json()).data.online).toBe(true);

    const { data } = await createAction();
    await waitFor(() => messages.some((message) => message.type === "desktop:action-requested"));
    expect(messages.find((message) => message.type === "desktop:action-requested")).toEqual({
      type: "desktop:action-requested",
      data,
    });

    const otherCapability = await fetch(`${baseUrl}/api/desktop-actions/capabilities`, {
      headers: { "X-API-Key": other.apiKey },
    });
    expect(otherCapability.status).toBe(200);
    expect((await otherCapability.json()).data.online).toBe(false);
    socket.close();
  });
});

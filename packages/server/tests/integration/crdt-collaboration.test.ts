import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import path from "node:path";
import * as Y from "yjs";
import { BOOTSTRAP_USER_ID } from "../../src/lib/meta-sqlite.js";
import { evictConnectionForDbPath } from "../../src/lib/app-db.js";
import { createTestPage, createTestServer, getAppUrl, getTestApiKey } from "./helpers.js";

describe("CRDT collaboration API", () => {
  let app: FastifyInstance;
  let baseUrl: string;
  let dataDir: string;
  let stop: () => Promise<void>;
  const owner = BOOTSTRAP_USER_ID;
  const apiKey = getTestApiKey();

  beforeAll(async () => {
    const server = await createTestServer();
    app = server.app;
    baseUrl = getAppUrl(app);
    dataDir = server.dataDir;
    stop = server.stop;
  });

  afterAll(async () => stop());

  async function setupPage(pageName: string, overrides: Record<string, unknown> = {}) {
    await createTestPage(app, owner, pageName);
    const metaPath = path.join(dataDir, owner, pageName, "meta.json");
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
    meta.collaboration = {
      enabled: true,
      overlay: true,
      resources: {
        documents: {
          mode: "crdt",
          read: "authenticated",
          write: "authenticated",
          awareness: true,
          overlay: true,
          maxDocumentBytes: 1024 * 1024,
          ...overrides,
        },
      },
    };
    fs.writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`);
  }

  async function post(pageName: string, endpoint: string, body: Record<string, unknown>, authenticated = true) {
    return fetch(`${baseUrl}/serve/${owner}/${pageName}/api/crdt/${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authenticated ? { "X-API-Key": apiKey } : {}),
      },
      body: JSON.stringify(body),
    });
  }

  it("merges concurrent Yjs updates and returns only the missing state", async () => {
    const pageName = "crdt-convergence";
    await setupPage(pageName);
    const left = new Y.Doc();
    const right = new Y.Doc();
    left.getText("body").insert(0, "left");
    right.getText("body").insert(0, "right");

    for (const [clientId, update] of [["left-client", Y.encodeStateAsUpdate(left)], ["right-client", Y.encodeStateAsUpdate(right)]] as const) {
      const response = await post(pageName, "update", {
        resource: "documents",
        documentId: "proposal-1",
        clientId,
        update: encode(update),
      });
      expect(response.status).toBe(200);
    }

    const merged = new Y.Doc();
    const sync = await post(pageName, "sync", {
      resource: "documents",
      documentId: "proposal-1",
      stateVector: encode(Y.encodeStateVector(merged)),
    });
    expect(sync.status).toBe(200);
    const syncBody = await sync.json();
    Y.applyUpdate(merged, decode(syncBody.data.update));
    expect(merged.getText("body").toString()).toContain("left");
    expect(merged.getText("body").toString()).toContain("right");

    const noDiff = await post(pageName, "sync", {
      resource: "documents",
      documentId: "proposal-1",
      stateVector: encode(Y.encodeStateVector(merged)),
    });
    const noDiffBody = await noDiff.json();
    expect(decode(noDiffBody.data.update).byteLength).toBeLessThanOrEqual(2);
    const dbPath = path.join(dataDir, owner, pageName, "app.db");
    expect(fs.existsSync(dbPath)).toBe(true);

    evictConnectionForDbPath(dbPath);
    const recovered = new Y.Doc();
    const afterReopen = await post(pageName, "sync", {
      resource: "documents",
      documentId: "proposal-1",
      stateVector: encode(Y.encodeStateVector(recovered)),
    });
    expect(afterReopen.status).toBe(200);
    Y.applyUpdate(recovered, decode((await afterReopen.json()).data.update));
    expect(recovered.getText("body").toString()).toEqual(merged.getText("body").toString());
  });

  it("rejects anonymous writes and damaged updates", async () => {
    const pageName = "crdt-security";
    await setupPage(pageName);
    const anonymous = await post(pageName, "update", {
      resource: "documents",
      documentId: "doc-1",
      clientId: "anonymous-client",
      update: encode(new Uint8Array([1, 2, 3])),
    }, false);
    expect(anonymous.status).toBe(401);

    const malformed = await post(pageName, "update", {
      resource: "documents",
      documentId: "doc-1",
      clientId: "owner-client",
      update: encode(new Uint8Array([255, 255, 255])),
    });
    expect(malformed.status).toBe(400);
    await expect(malformed.json()).resolves.toMatchObject({ code: "CRDT_UPDATE_INVALID" });

    const malformedStateVector = await post(pageName, "sync", {
      resource: "documents",
      documentId: "empty-doc",
      stateVector: encode(new Uint8Array([255, 255, 255])),
    });
    expect(malformedStateVector.status).toBe(400);
    await expect(malformedStateVector.json()).resolves.toMatchObject({ code: "CRDT_STATE_VECTOR_INVALID" });
  });

  it("broadcasts canonical server identity and editing target awareness", async () => {
    const pageName = "crdt-awareness";
    await setupPage(pageName);
    const events = await fetch(`${baseUrl}/serve/${owner}/${pageName}/api/crdt/events?resource=documents&documentId=doc-2&clientId=viewer`, {
      headers: { "X-API-Key": apiKey },
    });
    expect(events.status).toBe(200);
    const reader = events.body!.getReader();
    await reader.read();

    const awareness = await post(pageName, "awareness", {
      resource: "documents",
      documentId: "doc-2",
      clientId: "editor-window",
      clock: 1,
      user: { id: "forged", name: "forged", color: "red" },
      state: {
        editing: { surfaceId: "proposal:2", fieldId: "title", label: "标题" },
      },
    });
    expect(awareness.status).toBe(200);

    const event = await readSse(reader, "crdt:awareness");
    expect(event.data.peers).toContainEqual(expect.objectContaining({
      clientId: "editor-window",
      clock: 1,
      overlay: true,
      user: expect.objectContaining({ id: owner }),
      editing: expect.objectContaining({ surfaceId: "proposal:2", fieldId: "title", label: "标题" }),
    }));
    expect(event.data.peers[0].user.name).not.toBe("forged");

    const cleared = await post(pageName, "awareness", {
      resource: "documents",
      documentId: "doc-2",
      clientId: "editor-window",
      clock: 2,
      state: null,
    });
    expect(cleared.status).toBe(200);
    const afterClear = await fetch(`${baseUrl}/serve/${owner}/${pageName}/api/crdt/events?resource=documents&documentId=doc-2&clientId=viewer-2`, {
      headers: { "X-API-Key": apiKey },
    });
    const emptyEvent = await readSse(afterClear.body!.getReader(), "crdt:awareness");
    expect(emptyEvent.data.peers).toEqual([]);
  });
});

function encode(value: Uint8Array): string {
  return Buffer.from(value).toString("base64url");
}

function decode(value: string): Uint8Array {
  return Buffer.from(value, "base64url");
}

async function readSse(reader: ReadableStreamDefaultReader<Uint8Array>, eventName: string): Promise<any> {
  const decoder = new TextDecoder();
  let buffer = "";
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const { value } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: true });
    const match = buffer.match(new RegExp(`event: ${eventName}\\ndata: (.+)\\n\\n`));
    if (match) {
      await reader.cancel();
      return JSON.parse(match[1]);
    }
  }
  await reader.cancel();
  throw new Error(`No ${eventName} event received. Buffer: ${buffer}`);
}

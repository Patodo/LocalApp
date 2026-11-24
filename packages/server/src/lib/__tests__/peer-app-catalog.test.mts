import Fastify from "fastify";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { expect, it } from "vitest";
import { installAppPackage } from "@localapp/app-foundation/app-installer";
import { writeAppPackage } from "@localapp/app-foundation/app-package";
import { readPageMeta } from "@localapp/app-foundation/page-storage";
import { registerPeerProtocol } from "@localapp/dsh-app-sync/peer-protocol-routes";
import { registerPeers } from "@localapp/dsh-app-sync/peers-routes";
import { registerShadowSessions } from "../shadow-session.js";
import type { PeerStore } from "@localapp/dsh-app-sync/peer-store";

it("browses and copies the selected published package using the configured peer", async () => {
  const root = await mkdtemp(path.resolve("../../tmp/peer-catalog-"));
  const remote = Fastify();
  const local = Fastify();
  const owner = { id: "remote-owner", name: "remote-owner", displayName: null };
  const remoteDir = path.join(root, "remote");
  const localDir = path.join(root, "local");
  try {
    const archive = path.join(root, "todo-list.localapp");
    await writeAppPackage({
      outputPath: archive,
      metadata: { schemaVersion: 1, appId: "todo-list", version: "1.2.9", platformVersion: "^1.2" },
      files: [
        { path: "manifest.json", content: Buffer.from(JSON.stringify({ name: "todo-list", platformVersion: "^1.2", distDir: "dist" })) },
        { path: "dist/index.html", content: Buffer.from("<h1>Todo List</h1>") },
      ],
    });
    const released = await installAppPackage({ dataDir: remoteDir, ownerId: owner.id, packagePath: archive });
    let revoked = false;
    const keyOwner = (key: string) => !revoked && key === "test-peer-key" ? owner.id : null;
    const shadowSession = registerShadowSessions(remote, keyOwner);
    await registerPeerProtocol(remote, { dataDir: remoteDir, keyOwner, shadowSession, user: id => id === owner.id ? owner : null });
    remote.get("/api/me", async req => ({ id: req.visitorId }));
    remote.post("/serve/remote-owner/todo-list/api/task", async req => ({ actor: req.visitorId }));
    remote.get("/api/keys", async () => ({ success: true }));
    expect((await remote.inject("/api/peer/apps")).statusCode).toBe(401);
    const issue = { method: "POST" as const, url: "/api/peer/apps/todo-list/shadow-session" };
    expect((await remote.inject(issue)).statusCode).toBe(401);
    const session = await remote.inject({ ...issue, headers: { authorization: "Bearer test-peer-key" } });
    expect(session.statusCode).toBe(200);
    const ticket = session.json().data.ticket;
    expect(ticket).not.toContain("test-peer-key");
    const shadowHeaders = { "x-localapp-shadow-session": ticket };
    expect((await remote.inject({ url: "/api/me", headers: shadowHeaders })).json().id).toBe(owner.id);
    expect((await remote.inject({ method: "POST", url: "/serve/remote-owner/todo-list/api/task", headers: shadowHeaders })).json().actor).toBe(owner.id);
    expect((await remote.inject({ url: "/api/keys", headers: shadowHeaders })).statusCode).toBe(401);
    expect((await remote.inject({ url: "/serve/remote-owner/another-app/api/tasks", headers: shadowHeaders })).statusCode).toBe(401);
    revoked = true;
    expect((await remote.inject({ url: "/api/me", headers: shadowHeaders })).statusCode).toBe(401);
    revoked = false;
    const baseUrl = await remote.listen({ host: "127.0.0.1", port: 0 });
    const peers = { loadForCheck: (id: string) => id === "fixture" ? { baseUrl, apiKey: "test-peer-key" } : null };
    await registerPeers(local, peers as PeerStore, async scope => {
      scope.addHook("onRequest", async (req, reply) => {
        if (req.headers["x-fixture-admin"] !== "yes") return reply.code(401).send();
      });
    }, { dataDir: localDir, userId: () => "local-owner" });
    const headers = { "x-fixture-admin": "yes" };
    expect((await local.inject("/api/peers/fixture/apps")).statusCode).toBe(401);
    expect((await local.inject({ url: "/api/peers/unknown/apps", headers })).statusCode).toBe(404);
    const catalog = await local.inject({ url: "/api/peers/fixture/apps", headers });
    expect(catalog.statusCode).toBe(200);
    expect(catalog.json().data).toMatchObject([{ owner: owner.id, name: "todo-list", version: "1.2.9", digest: released.digest }]);
    expect(catalog.body).not.toContain("test-peer-key");

    const copy = { method: "POST" as const, url: "/api/peers/fixture/apps/todo-list/copy", headers };
    expect((await local.inject({ ...copy, payload: { digest: "0".repeat(64) } })).statusCode).toBe(502);
    expect(readPageMeta(localDir, "local-owner", "todo-list")).toBeNull();
    const installed = await local.inject({ ...copy, payload: { digest: released.digest } });
    expect(installed.statusCode).toBe(201);
    expect(installed.json().data).toMatchObject({ ownerId: "local-owner", appVersion: "1.2.9" });
    expect((await local.inject({ ...copy, payload: { digest: released.digest } })).statusCode).toBe(409);
  } finally {
    await Promise.all([remote.close(), local.close()]);
    await rm(root, { recursive: true, force: true });
  }
});

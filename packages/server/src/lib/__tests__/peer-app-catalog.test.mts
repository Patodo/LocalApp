import Fastify from "fastify";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { expect, it } from "vitest";
import { installAppPackage } from "@localapp/app-foundation/app-installer";
import { writeAppPackage } from "@localapp/app-foundation/app-package";
import { readPageMeta } from "@localapp/app-foundation/page-storage";
import { registerPeerProtocol } from "@localapp/dsh-app-sync/peer-protocol-routes";
import { registerPeers } from "@localapp/dsh-app-sync/peers-routes";
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
    await registerPeerProtocol(remote, {
      dataDir: remoteDir, keyOwner: key => key === "test-peer-key" ? owner.id : null,
      user: id => id === owner.id ? owner : null,
    });
    expect((await remote.inject("/api/peer/apps")).statusCode).toBe(401);
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

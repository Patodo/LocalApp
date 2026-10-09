import fs from "node:fs";
import path from "node:path";
import { beforeAll, afterAll, expect, it } from "vitest";
import { createTestServer } from "./helpers.js";
import { registerAndLogin } from "../helpers/createUser.js";
let server: Awaited<ReturnType<typeof createTestServer>>,
  alice: string,
  bob: string;
beforeAll(async () => {
  server = await createTestServer({
    dataRoot: path.resolve(
      __dirname,
      "../../../../tmp/platform-development/integration",
    ),
  });
  alice = await registerAndLogin(server.baseUrl, "developer");
  bob = await registerAndLogin(server.baseUrl, "reader");
}, 30000);
afterAll(async () => {
  await server?.stop();
});
const call = (cookie: string, url: string, method = "GET", body?: unknown) =>
  fetch(server.baseUrl + "/api/development/projects" + url, {
    method,
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
it("creates a builtin source project and rejects cross-user access and stale saves", async () => {
  expect((await call("", "/")).status).toBe(401);
  const create = await call(alice, "", "POST", { name: "browser-app" });
  expect(create.status).toBe(201);
  const p = (await create.json()).data;
  const files = (await (await call(alice, `/${p.id}/files`)).json()).data;
  expect(files).toContain("manifest.json");
  expect(files.some((f: string) => f.startsWith("src/"))).toBe(true);
  const f = (
    await (await call(alice, `/${p.id}/file?path=manifest.json`)).json()
  ).data;
  expect(JSON.parse(f.content).name).toBe("browser-app");
  expect((await call(bob, `/${p.id}/files`)).status).toBe(404);
  const changed = JSON.stringify({
    ...JSON.parse(f.content),
    description: "edited",
  });
  expect(
    (
      await call(alice, `/${p.id}/file`, "PUT", {
        path: f.path,
        hash: f.hash,
        content: changed,
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await call(alice, `/${p.id}/file`, "PUT", {
        path: f.path,
        hash: f.hash,
        content: "stale",
      })
    ).status,
  ).toBe(409);
  expect((await call(alice, `/${p.id}/file?path=../secret`)).status).toBe(400);
  const versions = (await (await call(alice, `/${p.id}/versions`)).json()).data;
  const diff = (
    await (await call(alice, `/${p.id}/diff?version=${versions[0].id}`)).json()
  ).data;
  expect(diff.some((d: any) => d.path === "manifest.json")).toBe(true);
  expect(
    (await call(alice, `/${p.id}/restore`, "POST", { version: versions[0].id }))
      .status,
  ).toBe(200);
  expect(
    (await call(alice, `/${p.id}/agent/run`, "POST", { prompt: "Read" }))
      .status,
  ).toBe(400);
}, 30000);

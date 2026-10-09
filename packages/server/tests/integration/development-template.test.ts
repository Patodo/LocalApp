import path from "node:path";
import { beforeAll, afterAll, it, expect } from "vitest";
import { createTestServer } from "./helpers.js";
import { registerAndLogin } from "../helpers/createUser.js";
let server: Awaited<ReturnType<typeof createTestServer>>, cookie: string;
beforeAll(async () => {
  server = await createTestServer({
    dataRoot: path.resolve(
      __dirname,
      "../../../../tmp/platform-development/template-integration",
    ),
  });
  cookie = await registerAndLogin(server.baseUrl, "templater");
}, 30000);
afterAll(async () => server?.stop());
it("builds the actual builtin template through the platform executor", async () => {
  const api = (url: string, body?: unknown) =>
    fetch(server.baseUrl + "/api/development/projects" + url, {
      method: body ? "POST" : "GET",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const p = (await (await api("", { name: "template-app" })).json()).data;
  const b = (await (await api(`/${p.id}/builds`, {})).json()).data;
  let build: any;
  for (let i = 0; i < 600; i++) {
    build = (await (await api(`/${p.id}/builds/${b.id}`)).json()).data;
    if (!["queued", "running"].includes(build.status)) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  expect(build.status, build.log).toBe("succeeded");
  expect(build.sha256).toMatch(/^[a-f0-9]{64}$/);
}, 150000);

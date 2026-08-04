import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestServer, getAppUrl, getTestApiKey } from "./helpers.js";
import { registerAndLogin } from "../helpers/createUser.js";
import fs from "node:fs";

describe("Full user workflow", () => {
  let baseUrl: string;
  let dataDir: string;
  let stop: () => Promise<void>;
  const apiKey = getTestApiKey();

  // State shared across the full workflow
  let cookie: string;
  let userApiKey: string;
  const username = "workflowuser";
  const password = "workflow123";
  const pageName = "my-app";
  const schemaName = "todos";

  beforeAll(async () => {
    const server = await createTestServer();
    baseUrl = getAppUrl(server.app);
    dataDir = server.dataDir;
    stop = server.stop;
  });

  afterAll(async () => {
    await stop();
  });

  function multipartBody(pageName: string, files: { name: string; content: string }[]): string {
    const boundary = "----WorkflowBoundary";
    let body = "";
    body += `--${boundary}\r\nContent-Disposition: form-data; name="name"\r\n\r\n${pageName}\r\n`;
    files.forEach((f, i) => {
      body += `--${boundary}\r\nContent-Disposition: form-data; name="filepath_${i}"\r\n\r\n${f.name}\r\n`;
    });
    files.forEach((f, i) => {
      body += `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${f.name}"\r\nContent-Type: text/html\r\n\r\n${f.content}\r\n`;
    });
    body += `--${boundary}--\r\n`;
    return body;
  }

  it("step 1: register and login", async () => {
    cookie = await registerAndLogin(baseUrl, username, password);
    expect(cookie).toMatch(/^token=/);

    // Verify session
    const res = await fetch(`${baseUrl}/api/me`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.id).toBe(username);
  });

  it("step 2: create an API key for the user", async () => {
    const res = await fetch(`${baseUrl}/api/keys`, {
      method: "POST",
      headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ userId: username }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    userApiKey = body.data.key;
    expect(userApiKey).toHaveLength(48);
  });

  it("step 3: create a page", async () => {
    const res = await fetch(`${baseUrl}/api/pages`, {
      method: "POST",
      headers: { "X-API-Key": userApiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ name: pageName }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.name).toBe(pageName);
  });

  it("step 4: define a schema", async () => {
    const res = await fetch(`${baseUrl}/api/schemas`, {
      method: "POST",
      headers: { "X-API-Key": userApiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        pageName,
        name: schemaName,
        fields: {
          title: { type: "TEXT", constraints: { required: true } },
          done: { type: "INTEGER", constraints: { required: true, default: 0 } },
        },
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it("step 5: upload HTML files", async () => {
    const boundary = "----WorkflowBoundary";
    const html = "<!DOCTYPE html><html><body><h1>My App</h1></body></html>";
    let body = "";
    body += `--${boundary}\r\nContent-Disposition: form-data; name="name"\r\n\r\n${pageName}\r\n`;
    body += `--${boundary}\r\nContent-Disposition: form-data; name="filepath_0"\r\n\r\nindex.html\r\n`;
    body += `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="index.html"\r\nContent-Type: text/html\r\n\r\n${html}\r\n`;
    body += `--${boundary}--\r\n`;

    const res = await fetch(`${baseUrl}/api/upload`, {
      method: "POST",
      headers: {
        "X-API-Key": userApiKey,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      },
      body,
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.data.version).toBe(1);
  });

  it("step 6: access the published page", async () => {
    const res = await fetch(`${baseUrl}/serve/${username}/${pageName}/`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("My App");
  });

  // step 7 原"CRUD data operations"测试已随 REST CRUD 端点整体移除
  // （restrict-app-api-to-named-sql 变更）。数据读写现在由 named SQL 唯一承担，
  // 该路径在 named-sql.test.ts 中专门覆盖。

  it("step 8: update profile (displayName + bio)", async () => {
    const res = await fetch(`${baseUrl}/api/me/profile`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ displayName: "工作流用户", bio: "全栈开发者" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.displayName).toBe("工作流用户");
    expect(body.data.bio).toBe("全栈开发者");
  });

  it("step 9: upload avatar", async () => {
    const formData = new FormData();
    const pngBuffer = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
      0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41,
      0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
      0x00, 0x00, 0x02, 0x00, 0x01, 0xe2, 0x21, 0xbc,
      0x33, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
      0x44, 0xae, 0x42, 0x60, 0x82,
    ]);
    formData.append("avatar", new Blob([pngBuffer], { type: "image/png" }), "avatar.png");

    const res = await fetch(`${baseUrl}/api/me/avatar`, {
      method: "POST",
      headers: { Cookie: cookie },
      body: formData,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.avatarUrl).toBe(`/api/avatar/${username}`);
  });

  it("step 10: change password", async () => {
    const res = await fetch(`${baseUrl}/api/me/password`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ oldPassword: password, newPassword: "newworkflow456" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it("step 11: login with new password", async () => {
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password: "newworkflow456" }),
    });
    expect(loginRes.status).toBe(200);
    const cookies = loginRes.headers.getSetCookie();
    const raw = cookies.find((c: string) => c.startsWith("token=")) || "";
    cookie = raw.split(";")[0];
    expect(cookie).toMatch(/^token=/);

    // Verify session still works
    const meRes = await fetch(`${baseUrl}/api/me`, { headers: { Cookie: cookie } });
    expect(meRes.status).toBe(200);
    const meBody = await meRes.json();
    expect(meBody.data.id).toBe(username);
    expect(meBody.data.displayName).toBe("工作流用户");
    expect(meBody.data.avatarUrl).toBe(`/api/avatar/${username}`);
  });

  it("step 12: delete the page", async () => {
    const res = await fetch(`${baseUrl}/api/pages/${pageName}`, {
      method: "DELETE",
      headers: { "X-API-Key": userApiKey },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.deleted).toBe(true);
  });

  it("step 13: verify page is gone", async () => {
    const res = await fetch(`${baseUrl}/api/pages/${pageName}`, {
      headers: { "X-API-Key": userApiKey },
    });
    expect(res.status).toBe(404);

    // Serve should also 404
    const serveRes = await fetch(`${baseUrl}/serve/${username}/${pageName}/`);
    expect(serveRes.status).toBe(404);
  });
});

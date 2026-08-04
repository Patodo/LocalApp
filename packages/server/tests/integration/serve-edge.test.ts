import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createTestServer, getAppUrl, getTestApiKey, crudUrl, createTestPage } from "./helpers.js";
import { registerAndLogin } from "../helpers/createUser.js";
import { BOOTSTRAP_USER_ID } from "../../src/lib/meta-sqlite.js";
import { readPageMeta, writePageMeta } from "../../src/plugins/storage.js";
import type { FastifyInstance } from "fastify";

describe("Serve edge cases", () => {
  let baseUrl: string;
  let app: FastifyInstance;
  let dataDir: string;
  let stop: () => Promise<void>;
  const apiKey = getTestApiKey();
  const userId = BOOTSTRAP_USER_ID;
  const pageName = "edge-serve";

  beforeAll(async () => {
    const server = await createTestServer();
    app = server.app;
    baseUrl = getAppUrl(server.app);
    dataDir = server.dataDir;
    stop = server.stop;

    // Create page and upload some files
    createTestPage(server.app, userId, pageName);

    // Upload index.html
    const boundary = "----EdgeBoundary";
    const html = [
      "<!doctype html>",
      "<html><head>",
      '<link rel="stylesheet" href="/assets/main.css">',
      "</head><body>",
      '<div id="root"><h1>Edge Test</h1></div>',
      '<script type="module" src="/assets/main.js"></script>',
      "</body></html>",
    ].join("");
    let body = "";
    body += `--${boundary}\r\nContent-Disposition: form-data; name="name"\r\n\r\n${pageName}\r\n`;
    body += `--${boundary}\r\nContent-Disposition: form-data; name="filepath_0"\r\n\r\nindex.html\r\n`;
    body += `--${boundary}\r\nContent-Disposition: form-data; name="filepath_1"\r\n\r\nassets/main.js\r\n`;
    body += `--${boundary}\r\nContent-Disposition: form-data; name="filepath_2"\r\n\r\nassets/main.css\r\n`;
    body += `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="index.html"\r\nContent-Type: text/html\r\n\r\n${html}\r\n`;
    body += `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="main.js"\r\nContent-Type: application/javascript\r\n\r\nconsole.log("hello");\r\n`;
    body += `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="main.css"\r\nContent-Type: text/css\r\n\r\nbody { margin: 0; }\r\n`;
    body += `--${boundary}--\r\n`;

    await fetch(`${baseUrl}/api/upload`, {
      method: "POST",
      headers: { "X-API-Key": apiKey, "Content-Type": `multipart/form-data; boundary=${boundary}` },
      body,
    });
  });

  afterAll(async () => {
    await stop();
  });

  describe("Raw app resource route", () => {
    it("serves raw index.html with CSP header and no PlatformShell markers", async () => {
      const res = await fetch(`${baseUrl}/serve/${userId}/${pageName}/`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-security-policy")).toContain("default-src 'self'");
      const html = await res.text();
      expect(html).toContain("Edge Test");
      expect(html).not.toContain("data-localapp-native-shell");
      expect(html).not.toContain("data-localapp-app-root");
    });

    it("serves raw non-HTML files with correct MIME type", async () => {
      const res = await fetch(`${baseUrl}/serve/${userId}/${pageName}/assets/main.js`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("application/javascript");
    });

    it("returns 404 for non-existent file", async () => {
      const res = await fetch(`${baseUrl}/serve/${userId}/${pageName}/nonexistent.css`);
      expect(res.status).toBe(404);
    });

    it("returns 404 for non-existent page", async () => {
      const res = await fetch(`${baseUrl}/serve/${userId}/nonexistent/`);
      expect(res.status).toBe(404);
    });

    it("raw SPA fallback serves index.html for extensionless paths", async () => {
      const res = await fetch(`${baseUrl}/serve/${userId}/${pageName}/some/route`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");
      expect(await res.text()).toContain("Edge Test");
    });
  });

  describe("Formal PlatformShell route", () => {
    it("returns native Platform Shell HTML with an app mount and without an iframe", async () => {
      const res = await fetch(`${baseUrl}/${userId}/${pageName}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");
      const html = await res.text();
      expect(html).toContain("_next/static/chunks");
      expect(html).toContain(pageName);
      expect(html).toContain("data-localapp-native-shell");
      expect(html).toContain("data-localapp-app-root");
      expect(html).toContain(`data-localapp-app-resource-base="/serve/${userId}/${pageName}/"`);
      expect(html).not.toContain('href="/serve/');
      expect(html).not.toContain("data-localapp-app-stylesheet");
      expect(html).not.toContain("<iframe");
      expect(html).not.toContain("sandbox=");
    });

    it("exposes the latest app resource base for native mounting", async () => {
      const res = await fetch(`${baseUrl}/${userId}/${pageName}`);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain(`/serve/${userId}/${pageName}/`);
      expect(html).toContain("data-localapp-app-resource-base");
    });

    it("未登录访问返回 Next.js Shell HTML（登录 UI 由客户端渲染）", async () => {
      const res = await fetch(`${baseUrl}/${userId}/${pageName}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");
    });

    it("已登录访问同样返回 Next.js Shell HTML（用户信息由客户端从 cookie 读取）", async () => {
      // Register and login
      const tokenCookie = await registerAndLogin(baseUrl, "shelluser", "password123");

      // createTestPage creates pages without pageAccess (= public)
      const res = await fetch(`${baseUrl}/${userId}/${pageName}`, {
        headers: { Cookie: tokenCookie },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");
    });
  });

  describe("Offline lifecycle gate", () => {
    it("keeps the formal shell while blocking raw root, static resources, and app API even for the owner", async () => {
      const owner = "offlineowner";
      const offlineApp = "offline-app";
      const ownerCookie = await registerAndLogin(baseUrl, owner, "password123");
      await createTestPage(app, owner, offlineApp);
      const versionDir = path.join(dataDir, owner, offlineApp, "versions", "v1");
      fs.mkdirSync(path.join(versionDir, "assets"), { recursive: true });
      fs.writeFileSync(path.join(versionDir, "index.html"), "<html><body>private app</body></html>");
      fs.writeFileSync(path.join(versionDir, "assets", "app.js"), "console.log('private')");
      const meta = readPageMeta(dataDir, owner, offlineApp)!;
      meta.lifecycle = { status: "offline" };
      meta.pageAccess = { level: "owner" };
      writePageMeta(dataDir, owner, offlineApp, meta);

      const anonymousFormal = await fetch(`${baseUrl}/${owner}/${offlineApp}`);
      expect(anonymousFormal.status).toBe(401);

      const formal = await fetch(`${baseUrl}/${owner}/${offlineApp}`, {
        headers: { Cookie: ownerCookie },
      });
      expect(formal.status).toBe(200);
      expect(formal.headers.get("content-type")).toContain("text/html");
      const formalHtml = await formal.text();
      expect(formalHtml).toContain("data-localapp-native-shell");
      expect(formalHtml).toContain(`data-localapp-app-resource-base="/serve/${owner}/${offlineApp}/"`);
      expect(formalHtml).not.toContain("该应用暂时无法访问，请稍后再试");

      const rawRoot = await fetch(`${baseUrl}/serve/${owner}/${offlineApp}`, {
        headers: { Cookie: ownerCookie },
        redirect: "manual",
      });
      expect(rawRoot.status).toBe(503);
      expect(rawRoot.headers.get("location")).toBeNull();
      await expect(rawRoot.json()).resolves.toMatchObject({ success: false, code: "APP_OFFLINE" });

      for (const requestPath of [
        `/serve/${owner}/${offlineApp}/`,
        `/serve/${owner}/${offlineApp}/assets/app.js`,
        `/serve/${owner}/${offlineApp}/api/time`,
      ]) {
        const response = await fetch(`${baseUrl}${requestPath}`, { headers: { Cookie: ownerCookie } });
        expect(response.status).toBe(503);
        await expect(response.json()).resolves.toMatchObject({ success: false, code: "APP_OFFLINE" });
      }
    });
  });
});

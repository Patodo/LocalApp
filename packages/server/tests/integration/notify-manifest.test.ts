import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestServer, getAppUrl, getTestApiKey, createTestPage } from "./helpers.js";
import type { FastifyInstance } from "fastify";
import { BOOTSTRAP_USER_ID } from "../../src/lib/meta-sqlite.js";
import fs from "node:fs";
import path from "node:path";

describe("manifest.notify 贯通（upload → meta.json → /meta API）", () => {
  let app: FastifyInstance;
  let baseUrl: string;
  let dataDir: string;
  let stop: () => Promise<void>;
  const apiKey = getTestApiKey();
  const owner = BOOTSTRAP_USER_ID;

  beforeAll(async () => {
    const server = await createTestServer();
    app = server.app;
    baseUrl = getAppUrl(app);
    dataDir = server.dataDir;
    stop = server.stop;
  });

  afterAll(async () => { await stop(); });

  function buildUpload(parts: { name: string; value: string }[], files: { filename: string; content: string }[] = [{ filename: "index.html", content: "<html></html>" }]): { body: string; contentType: string } {
    const boundary = "----NotifyManifestBoundary";
    let body = "";
    for (const p of parts) {
      body += `--${boundary}\r\nContent-Disposition: form-data; name="${p.name}"\r\n\r\n${p.value}\r\n`;
    }
    for (let i = 0; i < files.length; i++) {
      body += `--${boundary}\r\nContent-Disposition: form-data; name="filepath_${i}"\r\n\r\n${files[i].filename}\r\n`;
    }
    for (const f of files) {
      body += `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${f.filename}"\r\nContent-Type: application/octet-stream\r\n\r\n${f.content}\r\n`;
    }
    body += `--${boundary}--\r\n`;
    return { body, contentType: `multipart/form-data; boundary=${boundary}` };
  }

  async function uploadPage(pageName: string, notifyJson: string) {
    await createTestPage(app, owner, pageName);
    const { body, contentType } = buildUpload([
      { name: "name", value: pageName },
      { name: "notifyConfig", value: notifyJson },
    ]);
    return fetch(`${baseUrl}/api/upload`, {
      method: "POST",
      headers: { "X-API-Key": apiKey, "Content-Type": contentType },
      body,
    });
  }

  function readMeta(pageName: string): any {
    return JSON.parse(fs.readFileSync(path.join(dataDir, owner, pageName, "meta.json"), "utf-8"));
  }

  async function expectInvalidNotify(response: Response, pageName: string) {
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      success: false,
      code: "UPLOAD_MULTIPART_FIELD_INVALID",
      path: "notifyConfig",
      error: expect.stringContaining("invalid"),
    });
    expect(readMeta(pageName).notify).toBeUndefined();
  }

  describe("1.1 manifest.notify.enabled 校验", () => {
    it("notify.enabled = true 写入 meta.json", async () => {
      const res = await uploadPage("notify-true", JSON.stringify({ enabled: true }));
      expect(res.status).toBe(200);
      const meta = readMeta("notify-true");
      expect(meta.notify).toEqual({ enabled: true });
    });

    it("notify.enabled = false 写入 meta.json", async () => {
      const res = await uploadPage("notify-false", JSON.stringify({ enabled: false }));
      expect(res.status).toBe(200);
      const meta = readMeta("notify-false");
      expect(meta.notify).toEqual({ enabled: false });
    });

    it("notify.enabled 类型错误时返回明确错误且不写入", async () => {
      const res = await uploadPage("notify-typeerr", JSON.stringify({ enabled: "true" }));
      await expectInvalidNotify(res, "notify-typeerr");
    });

    it("notify.enabled 缺失时返回明确错误且不写入", async () => {
      const res = await uploadPage("notify-enabled-missing", JSON.stringify({}));
      await expectInvalidNotify(res, "notify-enabled-missing");
    });
  });

  describe("1.2 manifest.notify.permission.{table,userColumn,where} 校验", () => {
    it("完整 permission 配置写入 meta.json", async () => {
      const notify = {
        enabled: true,
        permission: { table: "users", userColumn: "id", where: "role = 'supervisor'" },
      };
      const res = await uploadPage("notify-perm-full", JSON.stringify(notify));
      expect(res.status).toBe(200);
      expect(readMeta("notify-perm-full").notify).toEqual(notify);
    });

    it("permission.table 类型错误时返回明确错误且不写入", async () => {
      const notify = { enabled: true, permission: { table: 123 } };
      const res = await uploadPage("notify-perm-table-typeerr", JSON.stringify(notify));
      await expectInvalidNotify(res, "notify-perm-table-typeerr");
    });

    it("permission.userColumn 类型错误时返回明确错误且不写入", async () => {
      const notify = { enabled: true, permission: { table: "users", userColumn: 123 } };
      const res = await uploadPage("notify-perm-col-typeerr", JSON.stringify(notify));
      await expectInvalidNotify(res, "notify-perm-col-typeerr");
    });

    it("permission.where 类型错误时返回明确错误且不写入", async () => {
      const notify = { enabled: true, permission: { table: "users", where: 123 } };
      const res = await uploadPage("notify-perm-where-typeerr", JSON.stringify(notify));
      await expectInvalidNotify(res, "notify-perm-where-typeerr");
    });

    it("permission 缺失 table 字段时返回明确错误且不写入", async () => {
      const notify = { enabled: true, permission: { userColumn: "id" } };
      const res = await uploadPage("notify-perm-table-missing", JSON.stringify(notify));
      await expectInvalidNotify(res, "notify-perm-table-missing");
    });
  });

  describe("1.5 GET /api/pages/:owner/:name/meta 返回 notify 字段", () => {
    it("已配置 notify 的页面，meta API 返回 notify", async () => {
      const notify = { enabled: true, permission: { table: "users", userColumn: "id" } };
      await uploadPage("notify-meta-api", JSON.stringify(notify));
      const res = await fetch(`${baseUrl}/api/pages/${owner}/notify-meta-api/meta`);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.notify).toEqual(notify);
    });

    it("未配置 notify 的页面，meta API 返回 notify=undefined（Shell 据此不渲染 🔔）", async () => {
      await createTestPage(app, owner, "no-notify-meta");
      const res = await fetch(`${baseUrl}/api/pages/${owner}/no-notify-meta/meta`);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.notify).toBeUndefined();
    });
  });
});

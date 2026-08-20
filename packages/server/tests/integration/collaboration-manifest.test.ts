import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import path from "node:path";
import { BOOTSTRAP_USER_ID } from "../../src/lib/meta-sqlite.js";
import { createTestPage, createTestServer, getAppUrl, getTestApiKey } from "./helpers.js";

describe("manifest.collaboration 贯通（upload → meta.json → /meta API）", () => {
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

  function multipart(parts: string[]): { body: string; contentType: string } {
    const boundary = `----CollaborationManifest${Date.now()}${Math.random()}`;
    return {
      body: `${parts.map((part) => `--${boundary}\r\n${part}`).join("")}--${boundary}--\r\n`,
      contentType: `multipart/form-data; boundary=${boundary}`,
    };
  }

  function field(name: string, value: string): string {
    return `Content-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
  }

  function file(name: string, filename: string, content: string, contentType: string): string {
    return [
      `Content-Disposition: form-data; name="${name}"; filename="${filename}"`,
      `Content-Type: ${contentType}`,
      "",
      content,
      "",
    ].join("\r\n");
  }

  async function upload(pageName: string, manifest: Record<string, unknown>, extraParts: string[] = []) {
    await createTestPage(app, owner, pageName);
    const upload = multipart([
      field("name", pageName),
      file("manifest", "manifest.json", JSON.stringify({ name: pageName, distDir: "dist", ...manifest }), "application/json"),
      field("filepath_0", "index.html"),
      file("files", "index.html", "<html><body>collab</body></html>", "text/html"),
      ...extraParts,
    ]);
    return fetch(`${baseUrl}/api/upload`, {
      method: "POST",
      headers: { "X-API-Key": apiKey, "Content-Type": upload.contentType },
      body: upload.body,
    });
  }

  function readMeta(pageName: string): any {
    return JSON.parse(fs.readFileSync(path.join(dataDir, owner, pageName, "meta.json"), "utf-8"));
  }

  const validCollaboration = {
    enabled: true,
    resources: {
      tasks: {
        mode: "record-versioned",
        mutation: "tasks.updateCollaborative",
        history: true,
      },
    },
  };

  const backendParts = [
    field("backendFilepath_0", "backend/resources/tasks/schema.json"),
    file("backendFiles", "schema.json", JSON.stringify({
      $schema: "https://localapp.dev/schemas/backend/resource-schema.schema.json",
      name: "tasks",
      fields: { title: { type: "string" } },
    }), "application/json"),
    field("backendFilepath_1", "backend/resources/tasks/mutations.json"),
    file("backendFiles", "mutations.json", JSON.stringify({
      $schema: "https://localapp.dev/schemas/backend/mutations.schema.json",
      mutations: {
        "tasks.updateCollaborative": {
          kind: "mutation",
          sql: "UPDATE tasks SET title = :title WHERE id = :id",
          params: { id: "string", title: "string" },
          access: "authenticated",
        },
      },
    }), "application/json"),
  ];

  it("合法 collaboration 配置写入 meta 且 meta API 返回", async () => {
    const res = await upload("collab-valid", {
      backend: { root: "backend" },
      collaboration: validCollaboration,
    }, backendParts);
    expect(res.status).toBe(200);
    expect(readMeta("collab-valid").collaboration).toEqual(validCollaboration);

    const metaRes = await fetch(`${baseUrl}/api/pages/${owner}/collab-valid/meta`);
    const metaBody = await metaRes.json();
    expect(metaBody.data.collaboration).toEqual(validCollaboration);
  });

  it("旧应用没有 collaboration 字段时正常加载且 meta API 不返回 collaboration", async () => {
    await createTestPage(app, owner, "collab-legacy");
    const metaRes = await fetch(`${baseUrl}/api/pages/${owner}/collab-legacy/meta`);
    expect(metaRes.status).toBe(200);
    const metaBody = await metaRes.json();
    expect(metaBody.data.collaboration).toBeUndefined();
  });

  it("接受可选 CRDT 资源与平台遮罩配置", async () => {
    const collaboration = {
      enabled: true,
      overlay: true,
      resources: {
        documents: {
          mode: "crdt",
          read: "authenticated",
          write: "authenticated",
          awareness: true,
          overlay: true,
          maxDocumentBytes: 5 * 1024 * 1024,
        },
      },
    };
    const res = await upload("collab-crdt-valid", {
      platformVersion: "^1.3",
      requires: { primitives: ["crdt", "editing-awareness-overlay"] },
      collaboration,
    });
    expect(res.status).toBe(200);
    expect(readMeta("collab-crdt-valid").collaboration).toEqual(collaboration);
  });

  it("拒绝未声明平台版本和 primitives 的 CRDT 应用", async () => {
    const res = await upload("collab-crdt-requires-missing", {
      platformVersion: "^1.2",
      collaboration: {
        enabled: true,
        resources: { documents: { mode: "crdt" } },
      },
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("platformVersion ^1.3");
  });

  it("拒绝 CRDT 匿名写入配置", async () => {
    const res = await upload("collab-crdt-public-write", {
      platformVersion: "^1.3",
      requires: { primitives: ["crdt", "editing-awareness-overlay"] },
      collaboration: {
        enabled: true,
        resources: { documents: { mode: "crdt", read: "public", write: "public" } },
      },
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("write cannot be public");
  });

  it("缺少 resource mutation 时拒绝上传", async () => {
    const res = await upload("collab-missing-mutation", {
      collaboration: { enabled: true, resources: { tasks: { mode: "record-versioned" } } },
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("collaboration.resources.tasks.mutation");
    expect(readMeta("collab-missing-mutation").collaboration).toBeUndefined();
  });

  it("unsupported mode 时拒绝上传", async () => {
    const res = await upload("collab-bad-mode", {
      collaboration: {
        enabled: true,
        resources: { tasks: { mode: "ot", mutation: "tasks.updateCollaborative" } },
      },
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("record-versioned");
    expect(readMeta("collab-bad-mode").collaboration).toBeUndefined();
  });

  it("mutation 未在 backend contract 中声明时拒绝上传", async () => {
    const res = await upload("collab-missing-contract-mutation", {
      backend: { root: "backend" },
      collaboration: validCollaboration,
    }, [
      field("backendFilepath_0", "backend/resources/tasks/schema.json"),
      file("backendFiles", "schema.json", JSON.stringify({
        $schema: "https://localapp.dev/schemas/backend/resource-schema.schema.json",
        name: "tasks",
        fields: { title: { type: "string" } },
      }), "application/json"),
      field("backendFilepath_1", "backend/resources/tasks/mutations.json"),
      file("backendFiles", "mutations.json", JSON.stringify({
        $schema: "https://localapp.dev/schemas/backend/mutations.schema.json",
        mutations: {},
      }), "application/json"),
    ]);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("tasks.updateCollaborative");
    expect(readMeta("collab-missing-contract-mutation").collaboration).toBeUndefined();
  });
});

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createTestServer, getAppUrl, getTestApiKey } from "./helpers.js";
import { readPageMeta } from "../../src/plugins/storage.js";

describe("Upload boundary conditions", () => {
  let baseUrl: string;
  let dataDir: string;
  let stop: () => Promise<void>;
  const apiKey = getTestApiKey();

  beforeAll(async () => {
    const server = await createTestServer();
    baseUrl = getAppUrl(server.app);
    dataDir = server.dataDir;
    stop = server.stop;

    // Create a page for uploads
    await fetch(`${baseUrl}/api/pages`, {
      method: "POST",
      headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "upload-test" }),
    });
  });

  afterAll(async () => {
    await stop();
  });

  function buildMultipart(fields: Record<string, string>, files: { name: string; filename: string; content: string; contentType?: string }[]): { body: string; contentType: string } {
    const boundary = "----UploadTestBoundary";
    let body = "";
    for (const [key, value] of Object.entries(fields)) {
      body += `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`;
    }
    for (const f of files) {
      body += `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${f.filename}"\r\nContent-Type: ${f.contentType || "text/html"}\r\n\r\n${f.content}\r\n`;
    }
    body += `--${boundary}--\r\n`;
    return { body, contentType: `multipart/form-data; boundary=${boundary}` };
  }

  function buildRawMultipart(boundary: string, parts: string[]): { body: string; contentType: string } {
    return {
      body: `${parts.map((part) => `--${boundary}\r\n${part}`).join("")}--${boundary}--\r\n`,
      contentType: `multipart/form-data; boundary=${boundary}`,
    };
  }

  function field(name: string, value: string): string {
    return `Content-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
  }

  function file(fieldName: string, filename: string, content: string, contentType: string): string {
    return [
      `Content-Disposition: form-data; name="${fieldName}"; filename="${filename}"`,
      `Content-Type: ${contentType}`,
      "",
      `${content}\r\n`,
    ].join("\r\n");
  }

  it("returns 400 when no files provided", async () => {
    const { body, contentType } = buildMultipart({ name: "upload-test" }, []);
    const res = await fetch(`${baseUrl}/api/upload`, {
      method: "POST",
      headers: { "X-API-Key": apiKey, "Content-Type": contentType },
      body,
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("No files");
  });

  it("returns 400 when page name missing", async () => {
    const { body, contentType } = buildMultipart({}, [
      { name: "file", filename: "index.html", content: "<html></html>" },
    ]);
    const res = await fetch(`${baseUrl}/api/upload`, {
      method: "POST",
      headers: { "X-API-Key": apiKey, "Content-Type": contentType },
      body,
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("Page name");
  });

  it("returns 404 when page does not exist", async () => {
    const { body, contentType } = buildMultipart(
      { name: "non-existent-page" },
      [{ name: "file", filename: "index.html", content: "<html></html>" }],
    );
    const res = await fetch(`${baseUrl}/api/upload`, {
      method: "POST",
      headers: { "X-API-Key": apiKey, "Content-Type": contentType },
      body,
    });
    expect(res.status).toBe(404);
  });

  it("returns a structured 400 for an invalid effective manifest before creating a version", async () => {
    const beforeVersion = readPageMeta(dataDir, "localadmin", "upload-test")!.currentVersion;
    const boundary = "----InvalidManifestBoundary";
    const upload = buildRawMultipart(boundary, [
      field("name", "upload-test"),
      file("manifest", "manifest.json", JSON.stringify({
        name: "upload-test",
        db: { mode: "crud", defaultAccess: null },
      }), "application/json"),
      field("filepath_0", "index.html"),
      file("files", "index.html", "<html><body>invalid manifest</body></html>", "text/html"),
    ]);

    const res = await fetch(`${baseUrl}/api/upload`, {
      method: "POST",
      headers: { "X-API-Key": apiKey, "Content-Type": upload.contentType },
      body: upload.body,
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      success: false,
      code: "UPLOAD_MANIFEST_INVALID",
      path: "db.defaultAccess",
      error: expect.stringContaining("must be an object"),
    });
    expect(readPageMeta(dataDir, "localadmin", "upload-test")?.currentVersion).toBe(beforeVersion);
    const versionsDir = path.join(dataDir, "localadmin", "upload-test", "versions");
    expect(fs.existsSync(path.join(versionsDir, `v${beforeVersion + 1}`))).toBe(false);
    expect(fs.existsSync(path.join(versionsDir, `.staging-v${beforeVersion + 1}`))).toBe(false);
  });

  it("rejects malformed multipart configuration instead of silently ignoring it", async () => {
    const beforeVersion = readPageMeta(dataDir, "localadmin", "upload-test")!.currentVersion;
    const { body, contentType } = buildMultipart(
      { name: "upload-test", dbConfig: "{" },
      [{ name: "file", filename: "index.html", content: "<html></html>" }],
    );

    const res = await fetch(`${baseUrl}/api/upload`, {
      method: "POST",
      headers: { "X-API-Key": apiKey, "Content-Type": contentType },
      body,
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      success: false,
      code: "UPLOAD_MULTIPART_FIELD_INVALID",
      path: "dbConfig",
    });
    expect(readPageMeta(dataDir, "localadmin", "upload-test")?.currentVersion).toBe(beforeVersion);
  });

  it("uploads multiple files", async () => {
    const boundary = "----MultiFileBoundary";
    let body = "";
    body += `--${boundary}\r\nContent-Disposition: form-data; name="name"\r\n\r\nupload-test\r\n`;
    body += `--${boundary}\r\nContent-Disposition: form-data; name="filepath_0"\r\n\r\nindex.html\r\n`;
    body += `--${boundary}\r\nContent-Disposition: form-data; name="filepath_1"\r\n\r\nstyle.css\r\n`;
    body += `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="index.html"\r\nContent-Type: text/html\r\n\r\n<html><link rel="stylesheet" href="style.css"></html>\r\n`;
    body += `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="style.css"\r\nContent-Type: text/css\r\n\r\nbody { color: red; }\r\n`;
    body += `--${boundary}--\r\n`;

    const res = await fetch(`${baseUrl}/api/upload`, {
      method: "POST",
      headers: { "X-API-Key": apiKey, "Content-Type": `multipart/form-data; boundary=${boundary}` },
      body,
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
  });

  it("rejects uploaded backend action that references an unbounded query before creating a version", async () => {
    const beforeVersion = readPageMeta(dataDir, "localadmin", "upload-test")?.currentVersion;
    const manifest = {
      name: "upload-test",
      distDir: "dist",
      backend: { root: "backend" },
    };
    const schema = {
      $schema: "https://localapp.dev/schemas/backend/resource-schema.schema.json",
      name: "work_items",
      fields: { title: { type: "string" } },
    };
    const queries = {
      $schema: "https://localapp.dev/schemas/backend/queries.schema.json",
      queries: {
        "work_items.listAll": {
          kind: "query",
          sql: "SELECT * FROM work_items",
          params: {},
        },
      },
    };
    const actions = {
      version: 1,
      bundle: "backend/actions.bundle.mjs",
      actions: [{
        name: "work_items.listRows",
        exportName: "listRows",
        access: "authenticated",
        uses: { queries: ["work_items.listAll"], mutations: [] },
        input: { type: "object" },
      }],
    };
    const boundary = "----InvalidBackendBoundary";
    const upload = buildRawMultipart(boundary, [
      field("name", "upload-test"),
      file("manifest", "manifest.json", JSON.stringify(manifest), "application/json"),
      field("filepath_0", "index.html"),
      file("files", "index.html", "<html><body>invalid backend</body></html>", "text/html"),
      field("backendFilepath_0", "backend/resources/work_items/schema.json"),
      file("backendFiles", "schema.json", JSON.stringify(schema), "application/json"),
      field("backendFilepath_1", "backend/resources/work_items/queries.json"),
      file("backendFiles", "queries.json", JSON.stringify(queries), "application/json"),
      field("backendFilepath_2", "backend/actions.manifest.json"),
      file("backendFiles", "actions.manifest.json", JSON.stringify(actions), "application/json"),
      field("backendFilepath_3", "backend/actions.bundle.mjs"),
      file("backendFiles", "actions.bundle.mjs", "export const listRows = { handler() { return []; } };", "text/javascript"),
    ]);

    const res = await fetch(`${baseUrl}/api/upload`, {
      method: "POST",
      headers: { "X-API-Key": apiKey, "Content-Type": upload.contentType },
      body: upload.body,
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/bounded|pagination|result|backend/i);
    expect(readPageMeta(dataDir, "localadmin", "upload-test")?.currentVersion).toBe(beforeVersion);
  });

  it("rejects platform 1.1 backend contracts that omit named SQL security", async () => {
    const beforeVersion = readPageMeta(dataDir, "localadmin", "upload-test")?.currentVersion;
    const manifest = {
      name: "upload-test",
      distDir: "dist",
      platformVersion: "^1.1",
      backend: { root: "backend" },
    };
    const queries = {
      $schema: "https://localapp.dev/schemas/backend/queries.schema.json",
      queries: {
        "work_items.list": {
          kind: "query",
          sql: "SELECT * FROM work_items LIMIT :limit OFFSET :offset",
          params: {
            limit: { type: "number", required: true },
            offset: { type: "number", required: true },
          },
          result: { mode: "page", maxRows: 100, maxBytes: 65536 },
          access: "authenticated",
        },
      },
    };
    const boundary = "----MissingSecurityBoundary";
    const upload = buildRawMultipart(boundary, [
      field("name", "upload-test"),
      file("manifest", "manifest.json", JSON.stringify(manifest), "application/json"),
      field("filepath_0", "index.html"),
      file("files", "index.html", "<html><body>missing security</body></html>", "text/html"),
      field("backendFilepath_0", "backend/resources/work_items/queries.json"),
      file("backendFiles", "queries.json", JSON.stringify(queries), "application/json"),
    ]);

    const res = await fetch(`${baseUrl}/api/upload`, {
      method: "POST",
      headers: { "X-API-Key": apiKey, "Content-Type": upload.contentType },
      body: upload.body,
    });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/security\.mode/i);
    expect(readPageMeta(dataDir, "localadmin", "upload-test")?.currentVersion).toBe(beforeVersion);
  });

  it("supports filepath_N subdirectory paths", async () => {
    const boundary = "----SubDirBoundary";
    let body = "";
    body += `--${boundary}\r\nContent-Disposition: form-data; name="name"\r\n\r\nupload-test\r\n`;
    body += `--${boundary}\r\nContent-Disposition: form-data; name="filepath_0"\r\n\r\nassets/main.js\r\n`;
    body += `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="main.js"\r\nContent-Type: application/javascript\r\n\r\nconsole.log("hello");\r\n`;
    body += `--${boundary}--\r\n`;

    const res = await fetch(`${baseUrl}/api/upload`, {
      method: "POST",
      headers: { "X-API-Key": apiKey, "Content-Type": `multipart/form-data; boundary=${boundary}` },
      body,
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
  });

  it("cleans up old versions when exceeding MAX_VERSIONS (10)", async () => {
    // Upload 11 versions total. The first should be cleaned up.
    for (let i = 0; i < 11; i++) {
      const boundary = `----VersionBoundary${i}`;
      const html = `<html><body>Version ${i}</body></html>`;
      let body = "";
      body += `--${boundary}\r\nContent-Disposition: form-data; name="name"\r\n\r\nupload-test\r\n`;
      body += `--${boundary}\r\nContent-Disposition: form-data; name="filepath_0"\r\n\r\nindex.html\r\n`;
      body += `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="index.html"\r\nContent-Type: text/html\r\n\r\n${html}\r\n`;
      body += `--${boundary}--\r\n`;

      const res = await fetch(`${baseUrl}/api/upload`, {
        method: "POST",
        headers: { "X-API-Key": apiKey, "Content-Type": `multipart/form-data; boundary=${boundary}` },
        body,
      });
      expect(res.status).toBe(200);
    }

    // After 11 uploads, meta should only keep last 10 versions
    const pageRes = await fetch(`${baseUrl}/api/pages/upload-test`, {
      headers: { "X-API-Key": apiKey },
    });
    const pageData = await pageRes.json();
    // The page was created with version 0, then 11 uploads = versions 1-11
    // After cleanup, should keep versions 2-11 (10 versions)
    expect(pageData.data.versions.length).toBeLessThanOrEqual(10);
  });
});

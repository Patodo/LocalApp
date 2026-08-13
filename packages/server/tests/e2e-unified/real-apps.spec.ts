import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "../../src/server.js";
import { closeMetaDb, createUser, findUserByName } from "../../src/lib/meta-sqlite.js";
import { SetupTokenStore } from "../../src/lib/setup-token-store.js";
import { writeAppPackage, type PortablePackageFile } from "../../src/lib/app-package.js";
import {
  createSkillInstallRequest,
  FIXTURE_SKILL_BODY,
} from "../../../../examples/skill-market/src/device-action";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../");
const ACCEPTANCE_ROOT = path.join(REPO_ROOT, "tmp", "single-package-acceptance", "deterministic-real-apps");
const API_KEY = "real-apps-local-admin-key-1234567890";
const CONTROL_TOKEN = "real-apps-device-control-token";

type JsonEnvelope<T = any> = { success: boolean; data?: T; error?: string };

describe("real builtin applications", () => {
  let baseUrl = "";
  let dataDir = "";
  let packageDir = "";
  let ownerCookie = "";
  let outsiderCookie = "";
  let app: Awaited<ReturnType<typeof buildServer>>;

  beforeAll(async () => {
    closeMetaDb();
    dataDir = path.join(ACCEPTANCE_ROOT, `real-apps-server-${process.pid}`);
    packageDir = path.join(ACCEPTANCE_ROOT, `real-apps-packages-${process.pid}`);
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(packageDir, { recursive: true, force: true });
    fs.mkdirSync(ACCEPTANCE_ROOT, { recursive: true });
    const setupTokens = new SetupTokenStore();
    app = await buildServer({
      setupTokens,
      env: {
        DATA_DIR: dataDir,
        BOOTSTRAP_API_KEY: API_KEY,
        JWT_SECRET: "real-apps-jwt-secret",
        TEMPLATE_REPO_URL: "https://github.com/example/template.git",
        ADMIN_STATIC_DIR: path.join(REPO_ROOT, "packages/web/out"),
        LOCALAPP_DEVICE_CONTROL_TOKEN: CONTROL_TOKEN,
      },
    });
    const issued = setupTokens.issue();
    const initialized = await app.inject({
      method: "POST",
      url: "/api/setup/initialize",
      payload: { token: issued.token, username: "localadmin", password: "localadmin" },
    });
    expect(initialized.statusCode).toBe(201);
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.addresses()[0];
    if (!address || typeof address === "string") throw new Error("real-app Server did not listen");
    baseUrl = `http://127.0.0.1:${address.port}`;
    const admin = findUserByName("localadmin");
    expect(admin).not.toBeNull();
    expect(await bcrypt.compare("localadmin", admin!.password)).toBe(true);
    ownerCookie = await loginCookie();
    createUser("resume-outsider", "resume-outsider", await bcrypt.hash("resume-outsider-password", 10));
    outsiderCookie = await loginCookie("resume-outsider", "resume-outsider-password");
  });

  afterAll(async () => {
    await app.close();
    closeMetaDb();
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(packageDir, { recursive: true, force: true });
  });

  it("installs both generated applications through the formal package endpoint", async () => {
    const skill = await buildPackage("skill-market");
    const resume = await buildPackage("resume-manager");
    for (const [name, packagePath] of [["skill-market", skill], ["resume-manager", resume]] as const) {
      const body = new FormData();
      body.append("package", new Blob([fs.readFileSync(packagePath)]), `${name}.localapp`);
      const response = await fetch(`${baseUrl}/api/me/apps/install`, {
        method: "POST",
        headers: { "X-API-Key": API_KEY },
        body,
      });
      expect(response.status, `${name} install`).toBe(201);
      const payload = await response.json() as JsonEnvelope<{ name: string }>;
      expect(payload.success).toBe(true);
      expect(payload.data?.name).toBe(name);

      const formal = await fetch(`${baseUrl}/localadmin/${name}/`, name === "resume-manager"
        ? { headers: { Cookie: ownerCookie } }
        : undefined);
      expect(formal.status, `${name} formal route`).toBe(200);
      expect(await formal.text()).toContain("data-localapp-app-resource-base");
    }
  });

  it("preserves resume upload metadata and original image/PDF bytes", async () => {
    const image = await uploadResume("portrait.png", "image/png");
    const pdf = await uploadResume("resume.pdf", "application/pdf");

    const imageRecord = await createResume({
      candidate_name: "Fixture Image",
      file_key: image.key,
      file_url: image.url,
      file_name: "portrait.png",
      mime_type: "image/png",
      size_bytes: image.bytes.length,
    });
    const pdfRecord = await createResume({
      candidate_name: "Fixture PDF",
      file_key: pdf.key,
      file_url: pdf.url,
      file_name: "resume.pdf",
      mime_type: "application/pdf",
      size_bytes: pdf.bytes.length,
    });

    expect(imageRecord.file_key).toBe(image.key);
    expect(pdfRecord.file_key).toBe(pdf.key);
    expect(await download(image.url)).toEqual(image.bytes);
    expect(await download(pdf.url)).toEqual(pdf.bytes);

    const list = await api<JsonEnvelope<{ rows: Array<{ id: number; mime_type: string }> }>>(
      "/serve/localadmin/resume-manager/api/queries/$resumes.list",
      { method: "POST", body: JSON.stringify({ params: { limit: 50, offset: 0 } }) },
    );
    expect(list.data?.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: imageRecord.lastInsertRowId, mime_type: "image/png" }),
      expect.objectContaining({ id: pdfRecord.lastInsertRowId, mime_type: "application/pdf" }),
    ]));

    const unauthenticatedDownload = await fetch(`${baseUrl}/serve/localadmin/resume-manager/api/content/${image.key}`);
    expect(unauthenticatedDownload.status).toBe(401);
    const outsiderDownload = await fetch(`${baseUrl}/serve/localadmin/resume-manager/api/content/${image.key}`, {
      headers: { Cookie: outsiderCookie },
    });
    expect(outsiderDownload.status).toBe(403);
    const ownerDownload = await fetch(`${baseUrl}/serve/localadmin/resume-manager/api/content/${image.key}`, {
      headers: { Cookie: ownerCookie },
    });
    expect(ownerDownload.status).toBe(200);
    expect(Buffer.from(await ownerDownload.arrayBuffer())).toEqual(image.bytes);

    const outsiderList = await fetch(`${baseUrl}/serve/localadmin/resume-manager/api/queries/$resumes.list`, {
      method: "POST",
      headers: { Cookie: outsiderCookie, "content-type": "application/json" },
      body: JSON.stringify({ params: { limit: 50, offset: 0 } }),
    });
    expect(outsiderList.status).toBe(403);
    const outsiderDelete = await fetch(`${baseUrl}/serve/localadmin/resume-manager/api/mutations/$resumes.delete`, {
      method: "POST",
      headers: { Cookie: outsiderCookie, "content-type": "application/json" },
      body: JSON.stringify({ params: { id: imageRecord.lastInsertRowId } }),
    });
    expect(outsiderDelete.status).toBe(403);

    await mutate("$resumes.delete", { id: imageRecord.lastInsertRowId });
    const afterDelete = await api<JsonEnvelope<{ rows: Array<{ id: number }> }>>(
      "/serve/localadmin/resume-manager/api/queries/$resumes.list",
      { method: "POST", body: JSON.stringify({ params: { limit: 50, offset: 0 } }) },
    );
    expect(afterDelete.data?.rows.some((row) => row.id === imageRecord.lastInsertRowId)).toBe(false);
  });

  it("runs the SKILL install action on the current computer with a narrow write permission", async () => {
    const installRoot = path.join(ACCEPTANCE_ROOT, "installed-skills");
    fs.rmSync(installRoot, { recursive: true, force: true });
    const request = createSkillInstallRequest(installRoot);
    expect(request.permissions).toEqual({ filesystemWrite: [installRoot], childProcess: false });

    const created = await api<JsonEnvelope<{ requestId: string; activationUrl: string; status: string }>>(
      "/serve/localadmin/skill-market/api/device-actions",
      {
        method: "POST",
        headers: { referer: `${baseUrl}/localadmin/skill-market/` },
        body: JSON.stringify(request),
      },
    );
    expect(created.data).toMatchObject({
      status: "awaiting_trust",
      activationUrl: `${baseUrl}/my/device-actions/?requestId=${created.data!.requestId}`,
    });

    const cookie = await loginCookie();
    const trust = await fetch(`${baseUrl}/api/device-actions/local/${created.data!.requestId}/trust`, {
      method: "POST",
      headers: { Cookie: cookie },
    });
    expect(trust.status).toBe(200);

    let snapshot: JsonEnvelope<{ status: string; result?: { installedPath: string } }> | undefined;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const response = await fetch(`${baseUrl}/api/device-actions/${created.data!.requestId}`, { headers: { Cookie: cookie } });
      snapshot = await response.json() as typeof snapshot;
      if (["succeeded", "failed", "cancelled"].includes(snapshot.data?.status ?? "")) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(snapshot?.data?.status, JSON.stringify(snapshot)).toBe("succeeded");
    const installed = path.join(installRoot, "localapp-device-actions", "SKILL.md");
    expect(snapshot?.data?.result?.installedPath).toBe(installed);
    expect(fs.readFileSync(installed, "utf8")).toBe(FIXTURE_SKILL_BODY);
    expect(fs.existsSync(path.join(ACCEPTANCE_ROOT, "installed-skills", "outside.txt"))).toBe(false);
  });

  async function buildPackage(name: "skill-market" | "resume-manager"): Promise<string> {
    const source = path.join(REPO_ROOT, "examples", name);
    const output = path.join(packageDir, `${name}.localapp`);
    fs.mkdirSync(packageDir, { recursive: true });
    const files: PortablePackageFile[] = [
      { path: "manifest.json", content: fs.readFileSync(path.join(source, "manifest.json")) },
    ];
    for (const folder of ["dist", "migrations", "backend"]) appendFiles(files, source, folder);
    await writeAppPackage({
      outputPath: output,
      metadata: { schemaVersion: 1, appId: name, version: "0.0.0", platformVersion: "^1.2" },
      files,
    });
    return output;
  }

  function appendFiles(files: PortablePackageFile[], source: string, folder: string): void {
    const root = path.join(source, folder);
    if (!fs.existsSync(root)) return;
    const walk = (current: string): void => {
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) walk(full);
        else files.push({ path: path.relative(source, full).split(path.sep).join("/"), content: fs.readFileSync(full) });
      }
    };
    walk(root);
  }

  async function api<T = JsonEnvelope>(pathname: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("X-API-Key", API_KEY);
    headers.set("content-type", "application/json");
    headers.set("Cookie", ownerCookie);
    const response = await fetch(`${baseUrl}${pathname}`, { ...init, headers });
    expect(response.ok, `${init.method ?? "GET"} ${pathname}: ${await response.clone().text()}`).toBe(true);
    return await response.json() as T;
  }

  async function uploadResume(name: "portrait.png" | "resume.pdf", mime: string): Promise<{ key: string; url: string; bytes: Buffer }> {
    const bytes = fs.readFileSync(path.join(REPO_ROOT, "examples/resume-manager/fixtures", name));
    const form = new FormData();
    form.append("file", new Blob([bytes], { type: mime }), name);
    const response = await fetch(`${baseUrl}/serve/localadmin/resume-manager/api/content/upload`, {
      method: "POST",
      headers: { "X-API-Key": API_KEY, Cookie: ownerCookie },
      body: form,
    });
    expect(response.status).toBe(201);
    const body = await response.json() as JsonEnvelope<{ key: string; url: string }>;
    return { ...body.data!, bytes };
  }

  async function createResume(params: Record<string, unknown>): Promise<{ lastInsertRowId: number; file_key: string }> {
    const body = await api<JsonEnvelope<{ lastInsertRowId: number }>>(
      "/serve/localadmin/resume-manager/api/mutations/$resumes.create",
      { method: "POST", body: JSON.stringify({ params }) },
    );
    return { lastInsertRowId: body.data!.lastInsertRowId, file_key: String(params.file_key) };
  }

  async function mutate(name: string, params: Record<string, unknown>): Promise<void> {
    await api(`/serve/localadmin/resume-manager/api/mutations/${name}`, { method: "POST", body: JSON.stringify({ params }) });
  }

  async function download(url: string): Promise<Buffer> {
    const response = await fetch(new URL(url, baseUrl), { headers: { Cookie: ownerCookie } });
    return Buffer.from(await response.arrayBuffer());
  }

  async function loginCookie(username = "localadmin", password = "localadmin"): Promise<string> {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const responseBody = await response.text();
    expect(response.status, responseBody).toBe(200);
    const cookie = response.headers.get("set-cookie");
    if (!cookie) throw new Error(`${username} session cookie missing`);
    return cookie.split(";", 1)[0];
  }
});

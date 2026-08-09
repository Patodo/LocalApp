import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { loadConfig } from "../src/lib/config.js";

describe("loadConfig", () => {
  let tmpDir: string;
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "qw-cfg-test-"));
    savedEnv = {};
    const envKeys = [
      "PORT", "DATA_DIR", "JWT_SECRET", "BOOTSTRAP_API_KEY",
      "TEMPLATE_REPO_URL", "GIT_DOWNLOAD_URL", "ADMIN_STATIC_DIR", "MIN_CLI_VERSION",
      "ALLOW_REGISTER", "ADMIN_DEFAULT_PASSWORD", "REGISTRATION_KEY", "AUTO_REGISTER_PATTERN",
      "LOCALAPP_RELEASE_MANIFEST_URL",
    ];
    for (const k of envKeys) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v !== undefined) process.env[k] = v;
      else delete process.env[k];
    }
  });

  function writeToml(content: string) {
    fs.writeFileSync(path.join(tmpDir, "config.toml"), content, "utf-8");
  }

  it("uses defaults when config.toml does not exist", async () => {
    const config = await loadConfig({ DATA_DIR: tmpDir } as NodeJS.ProcessEnv);
    expect(config.templateRepoUrl).toBe("");
    expect(config.port).toBe(3000);
    expect(config.jwtSecret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(fs.readFileSync(config.jwtKeyFile, "utf8")).toBe(config.jwtSecret);
    if (process.platform !== "win32") expect(fs.statSync(config.jwtKeyFile).mode & 0o777).toBe(0o600);
  });

  it("reads templateRepoUrl from config.toml", async () => {
    writeToml('[template]\nrepo_url = "https://example.com/repo.git"');
    const config = await loadConfig({ DATA_DIR: tmpDir } as NodeJS.ProcessEnv);
    expect(config.templateRepoUrl).toBe("https://example.com/repo.git");
    expect(config.port).toBe(3000);
  });

  it("env variable overrides config.toml", async () => {
    writeToml('[template]\nrepo_url = "https://from-toml.com"\n[server]\nport = 4000');
    const config = await loadConfig({
      DATA_DIR: tmpDir,
      TEMPLATE_REPO_URL: "https://from-env.com",
      PORT: "5000",
    } as NodeJS.ProcessEnv);
    expect(config.templateRepoUrl).toBe("https://from-env.com");
    expect(config.port).toBe(5000);
  });

  it("partial fields use defaults", async () => {
    writeToml('[template]\nrepo_url = "https://example.com"\n[auth]\njwt_secret = "secret123"');
    const config = await loadConfig({ DATA_DIR: tmpDir } as NodeJS.ProcessEnv);
    expect(config.templateRepoUrl).toBe("https://example.com");
    expect(config.jwtSecret).toBe("secret123");
    expect(config.port).toBe(3000);
    expect(config.minCliVersion).toBe("");
  });

  it("throws on invalid TOML", async () => {
    writeToml("this is not [valid toml {{{");
    await expect(loadConfig({ DATA_DIR: tmpDir } as NodeJS.ProcessEnv)).rejects.toThrow(/Failed to parse/);
  });

  it("does not throw when TEMPLATE_REPO_URL is missing", async () => {
    writeToml("[server]\nport = 8080");
    const config = await loadConfig({ DATA_DIR: tmpDir } as NodeJS.ProcessEnv);
    expect(config.port).toBe(8080);
    expect(config.templateRepoUrl).toBe("");
  });

  it("reads all fields from config.toml", async () => {
    writeToml([
      '[server]\nport = 8080\ndata_dir = "./my-data"',
      '[auth]\njwt_secret = "jwt-s"\nbootstrap_api_key = "bsk"',
      '[template]\nrepo_url = "https://repo"\ngit_download_url = "https://git"',
      '[admin]\nstatic_dir = "/static"',
      '[cli]\nmin_version = "1.2.3"',
    ].join("\n"));
    const config = await loadConfig({ DATA_DIR: tmpDir } as NodeJS.ProcessEnv);
    expect(config.port).toBe(8080);
    // dataDir is determined before reading config.toml, so toml's data_dir is ignored
    expect(config.dataDir).toBe(tmpDir);
    expect(config.jwtSecret).toBe("jwt-s");
    expect(config.bootstrapApiKey).toBe("bsk");
    expect(config.templateRepoUrl).toBe("https://repo");
    expect(config.gitDownloadUrl).toBe("https://git");
    expect(config.adminStaticDir).toBe("/static");
    expect(config.minCliVersion).toBe("1.2.3");
  });

  it("keeps the bootstrap admin password default without exposing auto registration config", async () => {
    const config = await loadConfig({ DATA_DIR: tmpDir } as NodeJS.ProcessEnv);
    expect(config.adminDefaultPassword).toBe("localadmin");
    expect(config).not.toHaveProperty("autoRegisterPattern");
  });

  it("configures the bootstrap admin password but ignores the old auto registration env", async () => {
    const config = await loadConfig({
      DATA_DIR: tmpDir,
      ADMIN_DEFAULT_PASSWORD: "env-pwd",
      AUTO_REGISTER_PATTERN: "^env$",
    } as NodeJS.ProcessEnv);
    expect(config.adminDefaultPassword).toBe("env-pwd");
    expect(config).not.toHaveProperty("autoRegisterPattern");
  });

  it("SHALL NOT expose allowRegister or registrationKey in returned config (removed from interface)", async () => {
    const config = await loadConfig({ DATA_DIR: tmpDir } as NodeJS.ProcessEnv) as Record<string, unknown>;
    expect(config).not.toHaveProperty("allowRegister");
    expect(config).not.toHaveProperty("registrationKey");
  });

  it("SHALL NOT read allow_register / registration_key from config.toml", async () => {
    writeToml('[auth]\nallow_register = true\nregistration_key = "should-be-ignored"');
    const config = await loadConfig({ DATA_DIR: tmpDir } as NodeJS.ProcessEnv) as Record<string, unknown>;
    expect(config).not.toHaveProperty("allowRegister");
    expect(config).not.toHaveProperty("registrationKey");
  });

  it("SHALL NOT read ALLOW_REGISTER / REGISTRATION_KEY from env", async () => {
    const config = await loadConfig({
      DATA_DIR: tmpDir,
      ALLOW_REGISTER: "true",
      REGISTRATION_KEY: "should-be-ignored",
    } as NodeJS.ProcessEnv) as Record<string, unknown>;
    expect(config).not.toHaveProperty("allowRegister");
    expect(config).not.toHaveProperty("registrationKey");
  });

  it("warns once without values when deprecated registration settings are present", async () => {
    writeToml('[auth]\nallow_register = true\nregistration_key = "toml-secret"\nauto_register_pattern = "^legacy$"');
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const env = {
      DATA_DIR: tmpDir,
      REGISTRATION_KEY: "env-secret",
      AUTO_REGISTER_PATTERN: "^env-secret-pattern$",
    } as NodeJS.ProcessEnv;

    const first = await loadConfig(env);
    const second = await loadConfig(env);

    expect(first).not.toHaveProperty("autoRegisterPattern");
    expect(second).not.toHaveProperty("autoRegisterPattern");
    expect(warning).toHaveBeenCalledTimes(1);
    const message = warning.mock.calls.flat().join(" ");
    expect(message).toContain("deprecated");
    expect(message).not.toContain("toml-secret");
    expect(message).not.toContain("env-secret");
    expect(message).not.toContain("legacy");
    warning.mockRestore();
  });

  it("resolves release manifest URL with env over config.toml over default", async () => {
    writeToml('[cli]\nrelease_manifest_url = "https://releases.example/toml.json"');

    const fromToml = await loadConfig({ DATA_DIR: tmpDir } as NodeJS.ProcessEnv);
    const fromEnv = await loadConfig({
      DATA_DIR: tmpDir,
      LOCALAPP_RELEASE_MANIFEST_URL: "https://releases.example/env.json",
    } as NodeJS.ProcessEnv);

    expect(fromToml.releaseManifestUrl).toBe("https://releases.example/toml.json");
    expect(fromEnv.releaseManifestUrl).toBe("https://releases.example/env.json");
  });
});

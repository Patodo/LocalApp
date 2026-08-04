import fs from "node:fs";
import path from "node:path";

export interface ServerConfig {
  port: number;
  dataDir: string;
  jwtSecret: string;
  bootstrapApiKey: string;
  templateRepoUrl: string;
  gitDownloadUrl: string;
  adminStaticDir: string;
  minCliVersion: string;
  releaseManifestUrl: string;
  llmApiKey: string;
  llmModel: string;
  llmBaseUrl: string;
  minioEndpoint: string;
  minioAccessKey: string;
  minioSecretKey: string;
  minioBucket: string;
  adminDefaultPassword: string;
  appDataArchiveMaxBytes: number;
  appDataExpandedMaxBytes: number;
  appDataArchiveMaxFiles: number;
}

const DEFAULTS: ServerConfig = {
  port: 3000,
  dataDir: "./data",
  jwtSecret: "",
  bootstrapApiKey: "",
  templateRepoUrl: "",
  gitDownloadUrl: "",
  adminStaticDir: "",
  minCliVersion: "",
  releaseManifestUrl: "",
  llmApiKey: "",
  llmModel: "gpt-4o-mini",
  llmBaseUrl: "https://api.openai.com/v1",
  minioEndpoint: "localhost:9000",
  minioAccessKey: "minioadmin",
  minioSecretKey: "minioadmin",
  minioBucket: "localapp-content",
  adminDefaultPassword: "localadmin",
  appDataArchiveMaxBytes: 2 * 1024 * 1024 * 1024,
  appDataExpandedMaxBytes: 4 * 1024 * 1024 * 1024,
  appDataArchiveMaxFiles: 10_000,
};

interface TomlConfigResult {
  values: Partial<ServerConfig>;
  hasDeprecatedRegistrationConfig: boolean;
}

const warnedDeprecatedConfigDirs = new Set<string>();

async function readTomlConfig(dataDir: string): Promise<TomlConfigResult> {
  const tomlPath = path.join(dataDir, "config.toml");
  if (!fs.existsSync(tomlPath)) {
    return { values: {}, hasDeprecatedRegistrationConfig: false };
  }

  const content = fs.readFileSync(tomlPath, "utf-8");
  let parsed: Record<string, unknown>;
  try {
    const TOML = await import("smol-toml");
    parsed = TOML.parse(content) as Record<string, unknown>;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse ${tomlPath}: ${msg}`);
  }

  const result: Partial<ServerConfig> = {};
  const server = parsed.server as Record<string, unknown> | undefined;
  const auth = parsed.auth as Record<string, unknown> | undefined;
  const template = parsed.template as Record<string, unknown> | undefined;
  const admin = parsed.admin as Record<string, unknown> | undefined;
  const cli = parsed.cli as Record<string, unknown> | undefined;
  const llm = parsed.llm as Record<string, unknown> | undefined;
  const minio = parsed.minio as Record<string, unknown> | undefined;

  if (server?.port != null) result.port = Number(server.port);
  if (server?.app_data_archive_max_bytes != null) result.appDataArchiveMaxBytes = Number(server.app_data_archive_max_bytes);
  if (server?.app_data_expanded_max_bytes != null) result.appDataExpandedMaxBytes = Number(server.app_data_expanded_max_bytes);
  if (server?.app_data_archive_max_files != null) result.appDataArchiveMaxFiles = Number(server.app_data_archive_max_files);
  if (server?.data_dir != null) result.dataDir = String(server.data_dir);
  if (auth?.jwt_secret != null) result.jwtSecret = String(auth.jwt_secret);
  if (auth?.bootstrap_api_key != null) result.bootstrapApiKey = String(auth.bootstrap_api_key);
  if (auth?.admin_default_password != null) result.adminDefaultPassword = String(auth.admin_default_password);
  if (template?.repo_url != null) result.templateRepoUrl = String(template.repo_url);
  if (template?.git_download_url != null) result.gitDownloadUrl = String(template.git_download_url);
  if (admin?.static_dir != null) result.adminStaticDir = String(admin.static_dir);
  if (cli?.min_version != null) result.minCliVersion = String(cli.min_version);
  if (cli?.release_manifest_url != null) result.releaseManifestUrl = String(cli.release_manifest_url);
  if (llm?.api_key != null) result.llmApiKey = String(llm.api_key);
  if (llm?.model != null) result.llmModel = String(llm.model);
  if (llm?.base_url != null) result.llmBaseUrl = String(llm.base_url);
  if (minio?.endpoint != null) result.minioEndpoint = String(minio.endpoint);
  if (minio?.access_key != null) result.minioAccessKey = String(minio.access_key);
  if (minio?.secret_key != null) result.minioSecretKey = String(minio.secret_key);
  if (minio?.bucket != null) result.minioBucket = String(minio.bucket);

  return {
    values: result,
    hasDeprecatedRegistrationConfig:
      auth?.allow_register != null
      || auth?.registration_key != null
      || auth?.auto_register_pattern != null,
  };
}

function pickEnv(env: NodeJS.ProcessEnv, key: string, tomlValue: string | undefined, defaultVal: string): string {
  const envVal = env[key];
  if (envVal !== undefined && envVal !== "") return envVal;
  if (tomlValue !== undefined && tomlValue !== "") return tomlValue;
  return defaultVal;
}

function pickPositiveInteger(env: NodeJS.ProcessEnv, key: string, tomlValue: number | undefined, defaultValue: number): number {
  const raw = env[key] !== undefined && env[key] !== "" ? Number(env[key]) : (tomlValue ?? defaultValue);
  if (!Number.isSafeInteger(raw) || raw <= 0) throw new Error(`${key} must be a positive integer`);
  return raw;
}

export async function loadConfig(env: NodeJS.ProcessEnv = process.env): Promise<ServerConfig> {
  const dataDir = env.DATA_DIR || DEFAULTS.dataDir;
  const tomlResult = await readTomlConfig(dataDir);
  const toml = tomlResult.values;
  const hasDeprecatedEnvironmentConfig = [
    "ALLOW_REGISTER",
    "REGISTRATION_KEY",
    "AUTO_REGISTER_PATTERN",
  ].some((key) => env[key] !== undefined);
  if (
    (tomlResult.hasDeprecatedRegistrationConfig || hasDeprecatedEnvironmentConfig)
    && !warnedDeprecatedConfigDirs.has(dataDir)
  ) {
    warnedDeprecatedConfigDirs.add(dataDir);
    console.warn(
      "deprecated registration configuration was ignored; provision users through the admin interface.",
    );
  }

  const config: ServerConfig = {
    port: env.PORT ? parseInt(env.PORT, 10) : (toml.port ?? DEFAULTS.port),
    // dataDir is determined before reading config.toml — toml's data_dir must not override
    dataDir: dataDir,
    jwtSecret: pickEnv(env, "JWT_SECRET", toml.jwtSecret, DEFAULTS.jwtSecret),
    bootstrapApiKey: pickEnv(env, "BOOTSTRAP_API_KEY", toml.bootstrapApiKey, DEFAULTS.bootstrapApiKey),
    templateRepoUrl: pickEnv(env, "TEMPLATE_REPO_URL", toml.templateRepoUrl, DEFAULTS.templateRepoUrl),
    gitDownloadUrl: pickEnv(env, "GIT_DOWNLOAD_URL", toml.gitDownloadUrl, DEFAULTS.gitDownloadUrl),
    adminStaticDir: pickEnv(env, "ADMIN_STATIC_DIR", toml.adminStaticDir, DEFAULTS.adminStaticDir),
    minCliVersion: pickEnv(env, "MIN_CLI_VERSION", toml.minCliVersion, DEFAULTS.minCliVersion),
    releaseManifestUrl: pickEnv(
      env,
      "LOCALAPP_RELEASE_MANIFEST_URL",
      toml.releaseManifestUrl,
      DEFAULTS.releaseManifestUrl,
    ),
    llmApiKey: pickEnv(env, "LLM_API_KEY", toml.llmApiKey, DEFAULTS.llmApiKey),
    llmModel: pickEnv(env, "LLM_MODEL", toml.llmModel, DEFAULTS.llmModel),
    llmBaseUrl: pickEnv(env, "LLM_BASE_URL", toml.llmBaseUrl, DEFAULTS.llmBaseUrl),
    minioEndpoint: pickEnv(env, "MINIO_ENDPOINT", toml.minioEndpoint, DEFAULTS.minioEndpoint),
    minioAccessKey: pickEnv(env, "MINIO_ACCESS_KEY", toml.minioAccessKey, DEFAULTS.minioAccessKey),
    minioSecretKey: pickEnv(env, "MINIO_SECRET_KEY", toml.minioSecretKey, DEFAULTS.minioSecretKey),
    minioBucket: pickEnv(env, "MINIO_BUCKET", toml.minioBucket, DEFAULTS.minioBucket),
    adminDefaultPassword: pickEnv(env, "ADMIN_DEFAULT_PASSWORD", toml.adminDefaultPassword, DEFAULTS.adminDefaultPassword),
    appDataArchiveMaxBytes: pickPositiveInteger(env, "APP_DATA_ARCHIVE_MAX_BYTES", toml.appDataArchiveMaxBytes, DEFAULTS.appDataArchiveMaxBytes),
    appDataExpandedMaxBytes: pickPositiveInteger(env, "APP_DATA_EXPANDED_MAX_BYTES", toml.appDataExpandedMaxBytes, DEFAULTS.appDataExpandedMaxBytes),
    appDataArchiveMaxFiles: pickPositiveInteger(env, "APP_DATA_ARCHIVE_MAX_FILES", toml.appDataArchiveMaxFiles, DEFAULTS.appDataArchiveMaxFiles),
  };

  // TEMPLATE_REPO_URL is no longer mandatory at startup.
  // It is checked at point of use (template download handler) when remote cloning is requested.

  return config;
}

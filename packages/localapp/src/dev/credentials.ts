import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export interface DevCredentialPaths {
  apiKey: string;
  password: string;
  jwtSecret: string;
}

export interface DevCredentials {
  apiKey: string;
  password: string;
  jwtSecret: string;
  paths: DevCredentialPaths;
}

const API_KEY_PATTERN = /^localapp_dev_[0-9a-f]{64}$/;
const PASSWORD_PATTERN = /^localapp_dev_password_[0-9a-f]{64}$/;
const JWT_SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export async function readOrCreateDevCredentials(projectDir: string): Promise<DevCredentials> {
  const stateRoot = path.join(path.resolve(projectDir), "tmp/localapp-dev");
  await fs.mkdir(stateRoot, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") await fs.chmod(stateRoot, 0o700);
  const paths: DevCredentialPaths = {
    apiKey: path.join(stateRoot, "server-api-key"),
    password: path.join(stateRoot, "server-password"),
    jwtSecret: path.join(stateRoot, "server-jwt-secret"),
  };
  const [apiKey, password, jwtSecret] = await Promise.all([
    readOrCreatePrivateValue(paths.apiKey, API_KEY_PATTERN, () => `localapp_dev_${randomBytes(32).toString("hex")}`),
    readOrCreatePrivateValue(paths.password, PASSWORD_PATTERN, () => `localapp_dev_password_${randomBytes(32).toString("hex")}`),
    readOrCreatePrivateValue(paths.jwtSecret, JWT_SECRET_PATTERN, () => randomBytes(32).toString("base64url")),
  ]);
  return { apiKey, password, jwtSecret, paths };
}

async function readOrCreatePrivateValue(
  filePath: string,
  pattern: RegExp,
  generate: () => string,
): Promise<string> {
  const existing = await readPrivateValue(filePath);
  if (existing !== undefined) return validate(existing, pattern, filePath);
  const generated = generate();
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    handle = await fs.open(filePath, "wx", 0o600);
    await handle.writeFile(`${generated}\n`, "utf8");
    await handle.sync();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw privateCredentialError(filePath);
    const raced = await readPrivateValue(filePath);
    if (raced === undefined) throw privateCredentialError(filePath);
    return validate(raced, pattern, filePath);
  } finally {
    await handle?.close();
  }
  if (process.platform !== "win32") await fs.chmod(filePath, 0o600);
  return generated;
}

async function readPrivateValue(filePath: string): Promise<string | undefined> {
  let stat: Awaited<ReturnType<typeof fs.lstat>>;
  try {
    stat = await fs.lstat(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw privateCredentialError(filePath);
  }
  if (stat.isSymbolicLink() || !stat.isFile()) throw privateCredentialError(filePath);
  if (process.platform !== "win32") await fs.chmod(filePath, 0o600);
  const value = (await fs.readFile(filePath, "utf8")).trim();
  if (!value) throw privateCredentialError(filePath);
  return value;
}

function validate(value: string, pattern: RegExp, filePath: string): string {
  if (!pattern.test(value)) throw privateCredentialError(filePath);
  return value;
}

function privateCredentialError(filePath: string): Error {
  return new Error(`Local development credential is invalid or unsafe: ${filePath}. Remove the project's tmp/localapp-dev directory and retry.`);
}

import { getTestApiKey } from "../integration/helpers.js";
import bcrypt from "bcryptjs";
import { createApiKey, createUser } from "../../src/lib/meta-sqlite.js";

function extractTokenCookie(setCookies: string[]): string {
  const raw = setCookies.find((c) => c.startsWith("token=")) || "";
  return raw.split(";")[0];
}

/**
 * Create a test user via the admin provisioning endpoint, then immediately
 * change the password (clearing `must_change_password`) and log in to
 * obtain a session cookie. Returns both the API key and the cookie so
 * tests can pick whichever auth mode they need.
 *
 * Tests receive the one-time password and API key exactly once, matching
 * the production administrator provisioning flow.
 */
export async function createTestUser(
  baseUrl: string,
  username: string,
  password: string = "test123456",
): Promise<{ apiKey: string; cookie: string }> {
  const createRes = await fetch(`${baseUrl}/api/admin/users`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": getTestApiKey(),
    },
    body: JSON.stringify({ username }),
  });
  if (!createRes.ok && createRes.status !== 404) {
    throw new Error(`admin create failed for ${username}: ${createRes.status} ${await createRes.text()}`);
  }
  if (createRes.status === 404) {
    // Some focused tests intentionally mount only a subset of production routes.
    const passwordHash = await bcrypt.hash(password, 10);
    createUser(username, username, passwordHash);
    const apiKey = createApiKey(username).key;

    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (!loginRes.ok) {
      throw new Error(`login failed for ${username}: ${loginRes.status} ${await loginRes.text()}`);
    }
    return { apiKey, cookie: extractTokenCookie(loginRes.headers.getSetCookie()) };
  }

  const createBody = await createRes.json();
  const apiKey = createBody.data.credentials.apiKey as string;
  const temporaryPassword = createBody.data.credentials.temporaryPassword as string;

  // Force-change-password clears must_change_password and sets a known password
  // so subsequent /api/auth/login works.
  const changeRes = await fetch(`${baseUrl}/api/auth/force-change-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId: username, oldPassword: temporaryPassword, newPassword: password }),
  });
  if (!changeRes.ok) {
    throw new Error(`force-change-password failed for ${username}: ${changeRes.status} ${await changeRes.text()}`);
  }

  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!loginRes.ok) {
    throw new Error(`login failed for ${username}: ${loginRes.status} ${await loginRes.text()}`);
  }
  const cookie = extractTokenCookie(loginRes.headers.getSetCookie());

  return { apiKey, cookie };
}

/**
 * Drop-in replacement for the legacy inline `registerAndLogin` helpers.
 * Returns just the session cookie.
 */
export async function registerAndLogin(
  baseUrl: string,
  username: string,
  password: string = "test123456",
): Promise<string> {
  const { cookie } = await createTestUser(baseUrl, username, password);
  return cookie;
}

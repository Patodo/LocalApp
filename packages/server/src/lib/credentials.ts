import { randomBytes } from "node:crypto";

const TEMPORARY_PASSWORD_BYTES = 18;

export function generateTemporaryPassword(): string {
  return randomBytes(TEMPORARY_PASSWORD_BYTES).toString("base64url");
}

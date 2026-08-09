import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const VERSION = "v1";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** Encrypts short secrets with a Server-local AES-256-GCM master key. */
export class SecretBox {
  private key: Buffer | undefined;

  constructor(private readonly keyFile: string) {}

  seal(plaintext: string, aad: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", this.loadKey(), iv);
    cipher.setAAD(Buffer.from(aad, "utf8"));
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [VERSION, iv.toString("base64url"), ciphertext.toString("base64url"), tag.toString("base64url")].join(".");
  }

  open(sealed: string, aad: string): string {
    try {
      const [version, ivText, ciphertextText, tagText, extra] = sealed.split(".");
      if (version !== VERSION || !ivText || !ciphertextText || !tagText || extra !== undefined) throw new Error("invalid format");
      const iv = Buffer.from(ivText, "base64url");
      const ciphertext = Buffer.from(ciphertextText, "base64url");
      const tag = Buffer.from(tagText, "base64url");
      if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES || ciphertext.length === 0) throw new Error("invalid fields");
      const decipher = createDecipheriv("aes-256-gcm", this.loadKey(), iv);
      decipher.setAAD(Buffer.from(aad, "utf8"));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    } catch {
      throw new Error("Invalid encrypted credential");
    }
  }

  private loadKey(): Buffer {
    if (this.key) return this.key;
    const directory = path.dirname(this.keyFile);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    try {
      const descriptor = fs.openSync(this.keyFile, "wx", 0o600);
      try {
        const generated = randomBytes(KEY_BYTES);
        fs.writeFileSync(descriptor, generated);
        fs.fsyncSync(descriptor);
        this.key = generated;
      } finally {
        fs.closeSync(descriptor);
      }
    } catch (error: unknown) {
      const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
      if (code !== "EEXIST") throw error;
      const stored = fs.readFileSync(this.keyFile);
      if (stored.length !== KEY_BYTES) throw new Error("Peer master key must contain exactly 32 bytes");
      this.key = stored;
    }
    if (process.platform !== "win32") fs.chmodSync(this.keyFile, 0o600);
    return this.key!;
  }
}

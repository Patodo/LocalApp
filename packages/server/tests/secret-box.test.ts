import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SecretBox } from "../src/lib/secret-box.js";

const directories: string[] = [];

function createKeyFile(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "localapp-secret-box-"));
  directories.push(directory);
  return path.join(directory, "master.key");
}

afterEach(() => {
  while (directories.length) fs.rmSync(directories.pop()!, { recursive: true, force: true });
});

describe("SecretBox", () => {
  it("encrypts credentials with authenticated peer-specific additional data", () => {
    const keyFile = createKeyFile();
    const box = new SecretBox(keyFile);
    const sealed = box.seal("peer-api-key-that-must-not-leak", "peer-a");

    expect(sealed).not.toContain("peer-api-key-that-must-not-leak");
    expect(box.open(sealed, "peer-a")).toBe("peer-api-key-that-must-not-leak");
    expect(() => box.open(sealed, "peer-b")).toThrow("Invalid encrypted credential");
  });

  it("rejects ciphertext tampering and creates its master key with restrictive permissions", () => {
    const keyFile = createKeyFile();
    const box = new SecretBox(keyFile);
    const sealed = box.seal("peer-api-key-that-must-not-leak", "peer-a");
    const [version, iv, ciphertext, tag] = sealed.split(".");
    const tampered = `${version}.${iv}.${ciphertext.slice(0, -1)}A.${tag}`;

    expect(() => box.open(tampered, "peer-a")).toThrow("Invalid encrypted credential");
    if (process.platform !== "win32") expect(fs.statSync(keyFile).mode & 0o777).toBe(0o600);
    expect(fs.readFileSync(keyFile)).toHaveLength(32);
  });
});

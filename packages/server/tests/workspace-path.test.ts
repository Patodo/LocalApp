import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveWorkspacePath } from "../src/lib/workspace-path.js";

const temporaryDirectories: string[] = [];

function temporaryDirectory(prefix: string): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("resolveWorkspacePath", () => {
  it("rejects traversal, absolute paths, and an existing symlink escape", () => {
    const parent = temporaryDirectory("localapp-workspace-path-");
    const root = path.join(parent, "workspace");
    const outside = path.join(parent, "outside");
    fs.mkdirSync(root);
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, "secret.txt"), "secret");
    fs.symlinkSync(outside, path.join(root, "link"));

    expect(() => resolveWorkspacePath(root, "../../outside/secret.txt")).toThrow("workspace boundary");
    expect(() => resolveWorkspacePath(root, path.join(outside, "secret.txt"))).toThrow("workspace boundary");
    expect(() => resolveWorkspacePath(root, "link/secret.txt")).toThrow("workspace boundary");
  });

  it("rejects a write through a symlinked parent when the target does not exist", () => {
    const parent = temporaryDirectory("localapp-workspace-write-path-");
    const root = path.join(parent, "workspace");
    const outside = path.join(parent, "outside");
    fs.mkdirSync(root);
    fs.mkdirSync(outside);
    fs.symlinkSync(outside, path.join(root, "linked-parent"));

    expect(() => resolveWorkspacePath(root, "linked-parent/new-file.txt")).toThrow("workspace boundary");
    expect(fs.existsSync(path.join(outside, "new-file.txt"))).toBe(false);
  });

  it("returns confined existing and not-yet-created paths", () => {
    const root = temporaryDirectory("localapp-workspace-confined-");
    const realRoot = fs.realpathSync(root);
    fs.mkdirSync(path.join(root, "src"));
    fs.writeFileSync(path.join(root, "src", "existing.txt"), "ok");

    expect(resolveWorkspacePath(root, "src/existing.txt")).toBe(path.join(realRoot, "src", "existing.txt"));
    expect(resolveWorkspacePath(root, "src/new.txt")).toBe(path.join(realRoot, "src", "new.txt"));
    expect(resolveWorkspacePath(root, "")).toBe(realRoot);
  });
});

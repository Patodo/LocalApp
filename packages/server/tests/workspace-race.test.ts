import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { closeMetaDb, initMetaDb } from "../src/lib/meta-sqlite.js";
import { WorkspaceStore } from "../src/lib/workspace-store.js";

const roots: string[] = [];

afterEach(() => {
  closeMetaDb();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("workspace filesystem race confinement", () => {
  it("fails a read when an ancestor is replaced after the file descriptor opens", async () => {
    const fixture = await raceFixture("read");
    let swapped = false;
    fixture.store = new WorkspaceStore({
      workspaceDir: fixture.workspaceDir,
      fileOperations: {
        openSync(filePath, flags, mode) {
          const descriptor = fs.openSync(filePath, flags, mode);
          if (!swapped && String(filePath).endsWith("secret.txt")) {
            swapped = true;
            swapDirectory(fixture.insideDirectory, fixture.outsideDirectory);
          }
          return descriptor;
        },
      },
    });

    await expect(fixture.store.readFile(fixture.workspaceId, "owner", "safe/secret.txt"))
      .rejects.toThrow(/workspace boundary changed/i);
  });

  it("fails a write when its parent is replaced at atomic publication", async () => {
    const fixture = await raceFixture("write");
    const outsideTarget = path.join(fixture.outsideDirectory, "new.txt");
    let swapped = false;
    fixture.store = new WorkspaceStore({
      workspaceDir: fixture.workspaceDir,
      fileOperations: {
        renameSync(source, destination) {
          if (!swapped && String(source).includes(".localapp-write-")) {
            swapped = true;
            swapDirectory(fixture.insideDirectory, fixture.outsideDirectory);
          }
          fs.renameSync(source, destination);
        },
      },
    });

    await expect(fixture.store.writeFile(fixture.workspaceId, "owner", "safe/new.txt", "inside"))
      .rejects.toThrow();
    expect(fs.existsSync(outsideTarget)).toBe(false);
  });

  it("does not delete outside data when the workspace root is swapped before tombstoning", async () => {
    const fixture = await raceFixture("delete");
    const outsideSecret = path.join(fixture.outsideRoot, "keep.txt");
    fs.writeFileSync(outsideSecret, "keep");
    let swapped = false;
    fixture.store = new WorkspaceStore({
      workspaceDir: fixture.workspaceDir,
      fileOperations: {
        renameSync(source, destination) {
          if (!swapped && source === fixture.workspacePath) {
            swapped = true;
            fs.renameSync(fixture.workspacePath, `${fixture.workspacePath}.moved`);
            fs.symlinkSync(fixture.outsideRoot, fixture.workspacePath);
          }
          fs.renameSync(source, destination);
        },
      },
    });

    await expect(fixture.store.remove(fixture.workspaceId, "owner")).rejects.toThrow(/workspace boundary changed/i);
    expect(fs.readFileSync(outsideSecret, "utf8")).toBe("keep");
    expect(fixture.store.getOwned(fixture.workspaceId, "owner")).not.toBeNull();
  });
});

async function raceFixture(label: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `localapp-workspace-race-${label}-`));
  roots.push(root);
  await initMetaDb(root);
  const workspaceDir = path.join(root, "workspaces");
  let store = new WorkspaceStore({ workspaceDir });
  const workspace = await store.create({ name: label, ownerId: "owner" });
  const workspacePath = store.pathFor(workspace.id);
  const insideDirectory = path.join(workspacePath, "safe");
  const outsideRoot = path.join(root, "outside");
  const outsideDirectory = path.join(outsideRoot, "safe");
  fs.mkdirSync(insideDirectory);
  fs.mkdirSync(outsideDirectory, { recursive: true });
  fs.writeFileSync(path.join(insideDirectory, "secret.txt"), "inside");
  fs.writeFileSync(path.join(outsideDirectory, "secret.txt"), "outside");
  return { root, workspaceDir, store, workspaceId: workspace.id, workspacePath, insideDirectory, outsideRoot, outsideDirectory };
}

function swapDirectory(inside: string, outside: string): void {
  fs.renameSync(inside, `${inside}.moved`);
  fs.symlinkSync(outside, inside);
}

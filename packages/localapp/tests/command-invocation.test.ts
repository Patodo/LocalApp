import { describe, expect, it } from "vitest";
import { resolveCommandInvocation, resolveExecutablePath, resolveOwnedCommand } from "../src/process/command-invocation.js";

const WINDOWS_ENV = { SystemRoot: "C:\\Windows" } as NodeJS.ProcessEnv;

describe("command invocation resolution", () => {
  it("routes a bare Windows package-manager name through the command interpreter", () => {
    // Break caught: Node cannot spawn a .cmd shim without a shell, and the
    // owned-process wrapper rejects a relative executable, so `npm`/`npm.cmd`
    // reached neither CreateProcessW nor cmd — `localapp init` failed to install
    // dependencies and `localapp dev` never started the project scripts.
    for (const name of ["npm", "npm.cmd", "pnpm", "yarn", "bun"]) {
      expect(resolveCommandInvocation(name, ["run", "test"], { platform: "win32", env: WINDOWS_ENV })).toEqual({
        command: "C:\\Windows\\System32\\cmd.exe",
        args: ["/d", "/s", "/c", name, "run", "test"],
      });
    }
  });

  it("honours an explicit interpreter and ComSpec", () => {
    expect(resolveCommandInvocation("npm", ["install"], { platform: "win32", commandInterpreter: "D:\\cmd.exe" }).command).toBe("D:\\cmd.exe");
    expect(resolveCommandInvocation("npm", ["install"], { platform: "win32", env: { ComSpec: "D:\\Windows\\cmd.exe" } as NodeJS.ProcessEnv }).command).toBe("D:\\Windows\\cmd.exe");
    expect(resolveCommandInvocation("npm", ["install"], { platform: "win32", env: {} as NodeJS.ProcessEnv }).command).toBe("C:\\Windows\\System32\\cmd.exe");
  });

  it("leaves an explicit path untouched so the owned-process wrapper keeps validating it", () => {
    const absolute = "C:\\Program Files\\nodejs\\node.exe";
    expect(resolveCommandInvocation(absolute, ["-e", "1"], { platform: "win32", env: WINDOWS_ENV })).toEqual({
      command: absolute,
      args: ["-e", "1"],
    });
    expect(resolveCommandInvocation("C:\\tools\\npm.cmd", [], { platform: "win32", env: WINDOWS_ENV }).command).toBe("C:\\tools\\npm.cmd");
  });

  it("keeps other platforms unchanged", () => {
    expect(resolveCommandInvocation("npm", ["run", "test"], { platform: "linux" })).toEqual({ command: "npm", args: ["run", "test"] });
    expect(resolveCommandInvocation("npm", ["run", "test"], { platform: "darwin" })).toEqual({ command: "npm", args: ["run", "test"] });
  });

  it("resolves a bare name to the file PATH would run, following PATHEXT", () => {
    const env = { PATH: "C:\\tools\\first;C:\\tools\\second", PATHEXT: ".COM;.EXE;.BAT;.CMD" } as NodeJS.ProcessEnv;
    // Windows resolves a bare name through PATHEXT, so npm's extensionless
    // POSIX script must not win over the .cmd shim sitting next to it.
    const present = new Set(["C:\\tools\\second\\npm", "C:\\tools\\second\\npm.cmd", "C:\\tools\\first\\other.exe"]);
    const isFile = (candidate: string) => present.has(candidate);
    expect(resolveExecutablePath("npm", { platform: "win32", env, isFile })).toBe("C:\\tools\\second\\npm.cmd");
    expect(resolveExecutablePath("missing", { platform: "win32", env, isFile })).toBeUndefined();
    // A name that already carries an extension is used as given.
    expect(resolveExecutablePath("other.exe", { platform: "win32", env, isFile })).toBe("C:\\tools\\first\\other.exe");
    // A path is already resolved and is never rewritten.
    expect(resolveExecutablePath("C:\\tools\\npm.cmd", { platform: "win32", env, isFile })).toBeUndefined();
  });

  it("hands the owned-process wrapper an absolute shim path so it can wrap .cmd itself", () => {
    // Break caught: the wrapper rejects a relative executable, so `localapp dev`
    // could never start `npm.cmd`; it now receives the absolute shim and wraps
    // it in the command interpreter on its own side.
    const env = { PATH: "C:\\tools", PATHEXT: ".CMD" } as NodeJS.ProcessEnv;
    const isFile = (candidate: string) => candidate === "C:\\tools\\npm.cmd";
    expect(resolveOwnedCommand("npm", { platform: "win32", env, isFile })).toBe("C:\\tools\\npm.cmd");
    expect(resolveOwnedCommand("npm", { platform: "linux", env })).toBe("npm");
    // Unresolvable names stay untouched so the wrapper reports the real failure.
    expect(resolveOwnedCommand("absent", { platform: "win32", env, isFile })).toBe("absent");
  });
});

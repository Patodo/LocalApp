import { describe, expect, it } from "vitest";
import { resolveCommandInvocation } from "../src/process/command-invocation.js";

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
});

import { describe, expect, it } from "vitest";
import { parseLocalAppArgs } from "./args.js";
import { runLocalApp } from "../main.js";

describe("parseLocalAppArgs", () => {
  it("parses server as the start alias and keeps foreground run distinct", () => {
    expect(parseLocalAppArgs(["server"])).toEqual({ kind: "server-start" });
    expect(parseLocalAppArgs(["server", "run", "--port", "0"])).toEqual({ kind: "server-run", port: 0 });
  });

  it("reports unknown options as structured stderr and exit code 1", async () => {
    let stderr = "";

    await expect(runLocalApp(["server", "--unknown"], {
      stdout: () => undefined,
      stderr: (value) => { stderr += value; },
    })).resolves.toBe(1);

    expect(JSON.parse(stderr)).toMatchObject({
      error: {
        code: "invalid_arguments",
        option: "--unknown",
      },
    });
  });

  it("rejects unexpected arguments after server run", () => {
    expect(() => parseLocalAppArgs(["server", "run", "unexpected"])).toThrow("Unexpected argument: unexpected");
  });
});

import { describe, expect, it } from "vitest";
import { parseLocalAppArgs } from "./args.js";
import { runLocalApp } from "../main.js";

describe("parseLocalAppArgs", () => {
  it.each([
    ["help with no arguments", [], { kind: "help", topic: "root" }],
    ["help command", ["help"], { kind: "help", topic: "root" }],
    ["help flag", ["--help"], { kind: "help", topic: "root" }],
    ["short help flag", ["-h"], { kind: "help", topic: "root" }],
    ["explicit server help", ["help", "server"], { kind: "help", topic: "server" }],
    ["explicit nested help", ["help", "app", "sync"], { kind: "help", topic: "app-sync" }],
    ["server help flag", ["server", "--help"], { kind: "help", topic: "server" }],
    ["server action short help", ["server", "run", "-h"], { kind: "help", topic: "server-run" }],
    ["app help flag", ["app", "--help"], { kind: "help", topic: "app" }],
    ["app command help flag", ["app", "install", "--help"], { kind: "help", topic: "app-install" }],
    ["command help after an argument", ["init", "example", "-h"], { kind: "help", topic: "init" }],
    ["version command", ["version"], { kind: "version" }],
    ["version flag", ["--version"], { kind: "version" }],
    ["short version flag", ["-V"], { kind: "version" }],
    ["server start alias", ["server"], { kind: "server-start" }],
    ["server explicit start", ["server", "start"], { kind: "server-start" }],
    ["server run defaults", ["server", "run"], { kind: "server-run" }],
    ["server run options", ["server", "run", "--data-dir", "data", "--host=127.0.0.1", "--port", "0"], { kind: "server-run", dataDir: "data", host: "127.0.0.1", port: 0 }],
    ["server stop", ["server", "stop"], { kind: "server-control", action: "stop" }],
    ["server restart", ["server", "restart"], { kind: "server-control", action: "restart" }],
    ["server status", ["server", "status"], { kind: "server-control", action: "status" }],
    ["server logs", ["server", "logs"], { kind: "server-control", action: "logs" }],
    ["server uninstall", ["server", "uninstall"], { kind: "server-control", action: "uninstall" }],
    ["internal daemon command is strict but not a public server action", ["_daemon"], { kind: "daemon" }],
    ["init defaults", ["init"], { kind: "init", skipInstall: false, skipDeploy: false }],
    ["init flags and name", ["init", "my-app", "--skip-install", "--skip-deploy"], { kind: "init", name: "my-app", skipInstall: true, skipDeploy: true }],
    ["check defaults", ["check"], { kind: "check", json: false }],
    ["check profile and JSON", ["check", "--json", "--profile", "work"], { kind: "check", json: true, profile: "work" }],
    ["package build output", ["build", "--package", "--output=release"], { kind: "build-package", output: "release" }],
    ["login preserves a padded inline API key", ["login", "https://example.test", "--api-key=abc=", "--profile", "work"], { kind: "login", serverUrl: "https://example.test", apiKey: "abc=", profile: "work" }],
    ["logout profile", ["logout", "--profile", "work"], { kind: "logout", profile: "work" }],
    ["whoami profile", ["whoami", "--profile=work"], { kind: "whoami", profile: "work" }],
    ["app install defaults", ["app", "install"], { kind: "app-install" }],
    ["app install options", ["app", "install", "--target", "local", "--package=app.localapp"], { kind: "app-install", target: "local", packagePath: "app.localapp" }],
    ["app sync defaults", ["app", "sync", "--peer", "office"], { kind: "app-sync", peer: "office", withData: false }],
    ["app sync options", ["app", "sync", "--peer", "office", "--target=local", "--with-data", "--confirm-app", "notes"], { kind: "app-sync", peer: "office", target: "local", withData: true, confirmation: "notes" }],
    ["development command", ["dev"], { kind: "dev" }],
    ["template sync defaults", ["sync-template"], { kind: "sync-template", quiet: false }],
    ["quiet template sync", ["sync-template", "--quiet"], { kind: "sync-template", quiet: true }],
    ["template ejection", ["eject-template"], { kind: "eject-template" }],
  ])("parses %s", (_description, argv, expected) => {
    expect(parseLocalAppArgs(argv as string[])).toEqual(expected);
  });

  it.each([
    ["unknown command", ["unknown"], "Unknown command: unknown"],
    ["unknown server action", ["server", "unknown"], "Unknown server command: unknown"],
    ["internal daemon arguments", ["_daemon", "extra"], "Unexpected argument: extra"],
    ["unknown run option", ["server", "run", "--unknown"], "Unknown option: --unknown"],
    ["non-numeric port", ["server", "run", "--port", "-1"], "Port must be an integer: -1"],
    ["out-of-range port", ["server", "run", "--port=65536"], "Port must be between 0 and 65535: 65536"],
    ["stray run argument", ["server", "run", "unexpected"], "Unexpected argument: unexpected"],
    ["duplicate option", ["check", "--profile", "one", "--profile", "two"], "Option may only be supplied once: --profile"],
    ["value supplied to flag", ["check", "--json=true"], "Option does not accept a value: --json"],
    ["missing option value", ["login", "--api-key"], "Option requires a value: --api-key"],
    ["multiple init names", ["init", "one", "two"], "init accepts at most one project name"],
    ["package build marker omitted", ["build"], "build requires --package"],
    ["missing app action", ["app"], "Unknown app command:"],
    ["missing app sync peer", ["app", "sync"], "app sync requires --peer"],
    ["unknown help topic", ["help", "extra"], "Unknown help topic: extra"],
  ])("rejects %s", (_description, argv, message) => {
    expect(() => parseLocalAppArgs(argv as string[])).toThrow(message);
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
        hint: "Run 'localapp server --help' for usage.",
      },
    });
  });

  it("points unknown nested commands to their parent help", async () => {
    let stderr = "";

    await expect(runLocalApp(["app", "unknown"], {
      stdout: () => undefined,
      stderr: (value) => { stderr += value; },
    })).resolves.toBe(1);

    expect(JSON.parse(stderr).error.hint).toBe("Run 'localapp app --help' for usage.");
  });

  it.each([
    [["-h"], ["Commands:", "server [start]", "app install"]],
    [["server", "run", "--help"], ["localapp server run [options]", "--data-dir <path>", "--host <address>"]],
    [["help", "app", "sync"], ["localapp app sync --peer <name>", "--with-data", "--confirm-app <name>"]],
  ])("prints useful help for %j", async (argv, expected) => {
    let stdout = "";
    let stderr = "";

    await expect(runLocalApp(argv, {
      stdout: (value) => { stdout += value; },
      stderr: (value) => { stderr += value; },
    })).resolves.toBe(0);

    expect(stderr).toBe("");
    for (const text of expected) expect(stdout).toContain(text);
  });
});

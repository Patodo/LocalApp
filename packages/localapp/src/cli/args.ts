import { resolveHelpTopic, type LocalAppHelpTopic } from "./help.js";

export type LocalAppCommand =
  | { kind: "help"; topic: LocalAppHelpTopic }
  | { kind: "version" }
  | { kind: "server-start" }
  | { kind: "server-run"; dataDir?: string; host?: string; port?: number }
  | { kind: "server-control"; action: "stop" | "restart" | "status" | "logs" | "uninstall" }
  | { kind: "daemon" }
  | { kind: "init"; name?: string; skipInstall: boolean; skipDeploy: boolean }
  | { kind: "check"; json: boolean; profile?: string }
  | { kind: "build-package"; output?: string }
  | { kind: "login"; serverUrl?: string; apiKey?: string; profile?: string }
  | { kind: "logout"; profile?: string }
  | { kind: "whoami"; profile?: string }
  | { kind: "app-install"; target?: string; packagePath?: string }
  | { kind: "app-sync"; target?: string; peer: string; withData: boolean; confirmation?: string }
  | { kind: "dev" }
  | { kind: "sync-template"; quiet: boolean }
  | { kind: "eject-template" };

export class LocalAppArgumentError extends Error {
  readonly code = "invalid_arguments";

  constructor(message: string, readonly option?: string) {
    super(message);
    this.name = "LocalAppArgumentError";
  }
}

export function parseLocalAppArgs(argv: string[]): LocalAppCommand {
  const args = [...argv];
  const command = args.shift();
  if (command === undefined) return help("root");
  if (command === "help") return parseHelp(args);
  if (command === "--help" || command === "-h") {
    requireNoArguments(args);
    return help("root");
  }
  if (command === "version" || command === "--version" || command === "-V") {
    if (hasHelp(args)) return help("version");
    requireNoArguments(args);
    return { kind: "version" };
  }

  switch (command) {
    case "server": return parseServer(args);
    case "init": return hasHelp(args) ? help("init") : parseInit(args);
    case "check": return hasHelp(args) ? help("check") : parseCheck(args);
    case "build": return hasHelp(args) ? help("build") : parseBuild(args);
    case "login": return hasHelp(args) ? help("login") : parseLogin(args);
    case "logout": return hasHelp(args) ? help("logout") : parseProfileCommand(args, "logout");
    case "whoami": return hasHelp(args) ? help("whoami") : parseProfileCommand(args, "whoami");
    case "app": return parseApp(args);
    case "dev": if (hasHelp(args)) return help("dev"); requireNoArguments(args); return { kind: "dev" };
    case "sync-template": return hasHelp(args) ? help("sync-template") : parseSyncTemplate(args);
    case "eject-template": if (hasHelp(args)) return help("eject-template"); requireNoArguments(args); return { kind: "eject-template" };
    case "_daemon": requireNoArguments(args); return { kind: "daemon" };
    default: throw new LocalAppArgumentError(`Unknown command: ${command}`, command);
  }
}

function parseServer(args: string[]): LocalAppCommand {
  const action = args.shift();
  if (isHelpFlag(action)) return help("server");
  if (action === undefined || action === "start") {
    if (hasHelp(args)) return help("server-start");
    requireNoArguments(args);
    return { kind: "server-start" };
  }
  if (action === "run") {
    if (hasHelp(args)) return help("server-run");
    const options = consumeOptions(args, new Set(["--data-dir", "--host", "--port"]));
    requireNoPositionals(options);
    const port = value(options, "--port");
    return {
      kind: "server-run",
      ...(value(options, "--data-dir") === undefined ? {} : { dataDir: value(options, "--data-dir") }),
      ...(value(options, "--host") === undefined ? {} : { host: value(options, "--host") }),
      ...(port === undefined ? {} : { port: parsePort(port) }),
    };
  }
  if (["stop", "restart", "status", "logs", "uninstall"].includes(action)) {
    if (hasHelp(args)) return help(`server-${action}` as LocalAppHelpTopic);
    requireNoArguments(args);
    return { kind: "server-control", action: action as "stop" | "restart" | "status" | "logs" | "uninstall" };
  }
  throw new LocalAppArgumentError(`Unknown server command: ${action}`, action);
}

function parseInit(args: string[]): LocalAppCommand {
  const options = consumeOptions(args, new Set(["--skip-install", "--skip-deploy"]), new Set(["--skip-install", "--skip-deploy"]));
  const positionals = positionalArguments(options);
  if (positionals.length > 1) throw new LocalAppArgumentError("init accepts at most one project name", positionals[1]);
  return {
    kind: "init",
    ...(positionals[0] === undefined ? {} : { name: positionals[0] }),
    skipInstall: options.has("--skip-install"),
    skipDeploy: options.has("--skip-deploy"),
  };
}

function parseCheck(args: string[]): LocalAppCommand {
  const options = consumeOptions(args, new Set(["--json", "--profile"]), new Set(["--json"]));
  requireNoPositionals(options);
  const profile = value(options, "--profile");
  return { kind: "check", json: options.has("--json"), ...(profile === undefined ? {} : { profile }) };
}

function parseBuild(args: string[]): LocalAppCommand {
  const options = consumeOptions(args, new Set(["--package", "--output"]), new Set(["--package"]));
  requireNoPositionals(options);
  if (!options.has("--package")) throw new LocalAppArgumentError("build requires --package", "--package");
  const output = value(options, "--output");
  return { kind: "build-package", ...(output === undefined ? {} : { output }) };
}

function parseLogin(args: string[]): LocalAppCommand {
  const options = consumeOptions(args, new Set(["--api-key", "--profile"]));
  const positionals = positionalArguments(options);
  if (positionals.length > 1) throw new LocalAppArgumentError("login accepts at most one server URL", positionals[1]);
  const apiKey = value(options, "--api-key");
  const profile = value(options, "--profile");
  return {
    kind: "login",
    ...(positionals[0] === undefined ? {} : { serverUrl: positionals[0] }),
    ...(apiKey === undefined ? {} : { apiKey }),
    ...(profile === undefined ? {} : { profile }),
  };
}

function parseProfileCommand(args: string[], command: "logout" | "whoami"): LocalAppCommand {
  const options = consumeOptions(args, new Set(["--profile"]));
  requireNoPositionals(options);
  const profile = value(options, "--profile");
  return { kind: command, ...(profile === undefined ? {} : { profile }) };
}

function parseApp(args: string[]): LocalAppCommand {
  const command = args.shift();
  if (isHelpFlag(command)) return help("app");
  if (command === "install") {
    if (hasHelp(args)) return help("app-install");
    const options = consumeOptions(args, new Set(["--target", "--package"]));
    requireNoPositionals(options);
    const target = value(options, "--target");
    const packagePath = value(options, "--package");
    return { kind: "app-install", ...(target === undefined ? {} : { target }), ...(packagePath === undefined ? {} : { packagePath }) };
  }
  if (command === "sync") {
    if (hasHelp(args)) return help("app-sync");
    const options = consumeOptions(args, new Set(["--peer", "--target", "--with-data", "--confirm-app"]), new Set(["--with-data"]));
    requireNoPositionals(options);
    const peer = value(options, "--peer");
    if (peer === undefined) throw new LocalAppArgumentError("app sync requires --peer", "--peer");
    const target = value(options, "--target");
    const confirmation = value(options, "--confirm-app");
    return {
      kind: "app-sync",
      peer,
      withData: options.has("--with-data"),
      ...(target === undefined ? {} : { target }),
      ...(confirmation === undefined ? {} : { confirmation }),
    };
  }
  throw new LocalAppArgumentError(`Unknown app command: ${command ?? ""}`, command);
}

function parseHelp(args: string[]): LocalAppCommand {
  const topicPath = args.filter((argument) => !isHelpFlag(argument));
  const topic = resolveHelpTopic(topicPath);
  if (topic === undefined) {
    const requested = topicPath.join(" ");
    throw new LocalAppArgumentError(`Unknown help topic: ${requested}`, topicPath[0]);
  }
  return help(topic);
}

function help(topic: LocalAppHelpTopic): LocalAppCommand {
  return { kind: "help", topic };
}

function hasHelp(args: string[]): boolean {
  return args.some(isHelpFlag);
}

function isHelpFlag(argument: string | undefined): boolean {
  return argument === "--help" || argument === "-h";
}

function parseSyncTemplate(args: string[]): LocalAppCommand {
  const options = consumeOptions(args, new Set(["--quiet"]), new Set(["--quiet"]));
  requireNoPositionals(options);
  return { kind: "sync-template", quiet: options.has("--quiet") };
}

type ParsedOptions = Map<string, string | true> & { positionals?: string[] };

function consumeOptions(args: string[], allowed: Set<string>, flags = new Set<string>()): ParsedOptions {
  const options: ParsedOptions = new Map();
  const positionals: string[] = [];
  while (args.length > 0) {
    const argument = args.shift()!;
    if (!argument.startsWith("--")) {
      positionals.push(argument);
      continue;
    }
    const equalsIndex = argument.indexOf("=");
    const option = equalsIndex < 0 ? argument : argument.slice(0, equalsIndex);
    const inlineValue = equalsIndex < 0 ? undefined : argument.slice(equalsIndex + 1);
    if (!allowed.has(option)) throw new LocalAppArgumentError(`Unknown option: ${option}`, option);
    if (options.has(option)) throw new LocalAppArgumentError(`Option may only be supplied once: ${option}`, option);
    if (flags.has(option)) {
      if (inlineValue !== undefined) throw new LocalAppArgumentError(`Option does not accept a value: ${option}`, option);
      options.set(option, true);
      continue;
    }
    const optionValue = inlineValue ?? args.shift();
    if (optionValue === undefined || optionValue.startsWith("--")) {
      throw new LocalAppArgumentError(`Option requires a value: ${option}`, option);
    }
    options.set(option, optionValue);
  }
  options.positionals = positionals;
  return options;
}

function positionalArguments(options: ParsedOptions): string[] {
  return options.positionals ?? [];
}

function requireNoPositionals(options: ParsedOptions): void {
  const positional = positionalArguments(options)[0];
  if (positional !== undefined) throw new LocalAppArgumentError(`Unexpected argument: ${positional}`, positional);
}

function requireNoArguments(args: string[]): void {
  if (args.length > 0) throw new LocalAppArgumentError(`Unexpected argument: ${args[0]}`, args[0]);
}

function value(options: ParsedOptions, option: string): string | undefined {
  const result = options.get(option);
  return typeof result === "string" ? result : undefined;
}

function parsePort(port: string): number {
  if (!/^\d+$/.test(port)) throw new LocalAppArgumentError(`Port must be an integer: ${port}`, "--port");
  const result = Number(port);
  if (!Number.isSafeInteger(result) || result > 65535) throw new LocalAppArgumentError(`Port must be between 0 and 65535: ${port}`, "--port");
  return result;
}

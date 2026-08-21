export type LocalAppHelpTopic =
  | "root"
  | "server"
  | "server-start"
  | "server-run"
  | "server-stop"
  | "server-restart"
  | "server-status"
  | "server-logs"
  | "server-uninstall"
  | "init"
  | "check"
  | "build"
  | "login"
  | "logout"
  | "whoami"
  | "app"
  | "app-install"
  | "app-sync"
  | "dev"
  | "sync-template"
  | "eject-template"
  | "version";

const TOPICS = new Map<string, LocalAppHelpTopic>([
  ["", "root"],
  ["server", "server"],
  ["server start", "server-start"],
  ["server run", "server-run"],
  ["server stop", "server-stop"],
  ["server restart", "server-restart"],
  ["server status", "server-status"],
  ["server logs", "server-logs"],
  ["server uninstall", "server-uninstall"],
  ["init", "init"],
  ["check", "check"],
  ["build", "build"],
  ["login", "login"],
  ["logout", "logout"],
  ["whoami", "whoami"],
  ["app", "app"],
  ["app install", "app-install"],
  ["app sync", "app-sync"],
  ["dev", "dev"],
  ["sync-template", "sync-template"],
  ["eject-template", "eject-template"],
  ["version", "version"],
]);

const HELP = new Map<LocalAppHelpTopic, string>([
  ["root", `LocalApp — run, develop, install, and synchronize LocalApp applications.

Usage:
  localapp <command> [options]
  localapp help [command [subcommand]]

Commands:
  server [start]    Install system integration and start the user daemon
  server run        Run the same Server in the foreground
  server <action>   stop, restart, status, logs, or uninstall the daemon
  init [name]       Create an application from the built-in template
  dev               Start the application development environment
  check             Validate the current application before installation
  build --package   Build a distributable .localapp package
  app install       Install the current application on a target Server
  app sync          Synchronize an application to a configured peer
  login [url]       Save credentials for a Server profile
  logout            Remove credentials for a Server profile
  whoami            Show the authenticated user for a Server profile
  sync-template     Update the CLI-managed application runtime and skills
  eject-template    Stop CLI management of the application template
  version           Print the installed LocalApp version

Global options:
  -h, --help        Show help for a command
  -V, --version     Print the installed LocalApp version

Examples:
  localapp server
  localapp init interview-app
  localapp dev
  localapp app install --target local
  localapp help app sync

Run 'localapp help <command>' or 'localapp <command> --help' for details.
`],
  ["server", `Manage the current user's unified LocalApp Server daemon.

Usage:
  localapp server [start]
  localapp server <action>

Actions:
  start       Install localapp:// integration and start the daemon (default)
  run         Run the same Server in the foreground
  stop        Stop the daemon
  restart     Restart the daemon
  status      Print daemon and Server health information
  logs        Print daemon logs
  uninstall   Stop and unregister the current-user service

Options:
  -h, --help  Show this help

Examples:
  localapp server
  localapp server status
  localapp server logs
  localapp server run --host 0.0.0.0 --port 3000

Run 'localapp help server <action>' for action-specific help.
`],
  ["server-start", noOptionsHelp(
    "Install localapp:// integration and start the current-user daemon.",
    "localapp server [start]",
    ["localapp server", "localapp server start"],
  )],
  ["server-run", `Run the unified LocalApp Server in the foreground.

Usage:
  localapp server run [options]

Options:
  --data-dir <path>   Server database, files, and configuration directory
  --host <address>    Listen address (default: 127.0.0.1)
  --port <number>     Listen port, 0 selects an available port (default: 0)
  -h, --help          Show this help

Examples:
  localapp server run
  localapp server run --data-dir ./localapp-data --port 3000
  localapp server run --host 0.0.0.0 --port 3000
`],
  ["server-stop", noOptionsHelp("Stop the current-user LocalApp daemon.", "localapp server stop", ["localapp server stop"])],
  ["server-restart", noOptionsHelp("Restart the current-user LocalApp daemon.", "localapp server restart", ["localapp server restart"])],
  ["server-status", noOptionsHelp("Print daemon status and Server health information as JSON.", "localapp server status", ["localapp server status"])],
  ["server-logs", noOptionsHelp("Print logs from the current-user LocalApp daemon.", "localapp server logs", ["localapp server logs"])],
  ["server-uninstall", noOptionsHelp("Stop and unregister the current-user LocalApp service.", "localapp server uninstall", ["localapp server uninstall"])],
  ["init", `Create or initialize an application from the built-in template.

Usage:
  localapp init [name] [options]

Arguments:
  name                 Project name (default: current directory name)

Options:
  --skip-install       Do not install template dependencies
  --skip-deploy        Do not install the new application on a Server
  -h, --help           Show this help

Examples:
  localapp init interview-app
  localapp init --skip-install --skip-deploy
`],
  ["check", `Validate the current application, contracts, migrations, and package metadata.

Usage:
  localapp check [options]

Options:
  --json               Emit machine-readable JSON
  --profile <name>     Use the named Server profile
  -h, --help           Show this help

Examples:
  localapp check
  localapp check --json
`],
  ["build", `Build the current application as a distributable .localapp package.

Usage:
  localapp build --package [options]

Options:
  --package            Required package-build mode
  --output <path>      Output file or directory
  -h, --help           Show this help

Examples:
  localapp build --package
  localapp build --package --output ./dist
`],
  ["login", `Save an API key for a LocalApp Server profile.

Usage:
  localapp login [server-url] [options]

Arguments:
  server-url           Target LocalApp Server URL

Options:
  --api-key <key>      API key issued by the target Server
  --profile <name>     Save under the named profile
  -h, --help           Show this help

Example:
  localapp login http://192.168.2.9:3000 --profile office --api-key <key>
`],
  ["logout", profileHelp("Remove saved credentials for a LocalApp Server profile.", "logout")],
  ["whoami", profileHelp("Show the authenticated identity for a LocalApp Server profile.", "whoami")],
  ["app", `Install or synchronize LocalApp applications.

Usage:
  localapp app <command> [options]

Commands:
  install   Build or read a .localapp package and install it on a Server
  sync      Synchronize an installed application to a configured peer

Options:
  -h, --help   Show this help

Examples:
  localapp app install --target local
  localapp app sync --peer office

Run 'localapp help app <command>' for command-specific help.
`],
  ["app-install", `Install the current project or an existing .localapp package.

Usage:
  localapp app install [options]

Options:
  --target <name>      Server profile or explicit target (default: project target)
  --package <path>     Install an existing .localapp package instead of building
  -h, --help           Show this help

Examples:
  localapp app install --target local
  localapp app install --target office --package ./dist/notes.localapp
`],
  ["app-sync", `Synchronize an installed application to a configured peer Server.

Usage:
  localapp app sync --peer <name> [options]

Options:
  --peer <name>        Required destination peer configured on the source Server
  --target <name>      Source Server profile (default: project target)
  --with-data          Also replace the destination application data and files
  --confirm-app <name> Exact application name required with --with-data
  -h, --help           Show this help

By default only the application package, manifest, migrations, and backend
contract are synchronized. --with-data first backs up the destination, then
atomically replaces that application's database and files.

Examples:
  localapp app sync --peer office
  localapp app sync --peer office --with-data --confirm-app notes
`],
  ["dev", noOptionsHelp(
    "Start the local application development environment and Dev Shell.",
    "localapp dev",
    ["localapp dev"],
  )],
  ["sync-template", `Update CLI-managed runtime files and Agent skills in the current project.

Usage:
  localapp sync-template [options]

Options:
  --quiet              Suppress the success result
  -h, --help           Show this help

Example:
  localapp sync-template
`],
  ["eject-template", noOptionsHelp(
    "Stop CLI management of the current project's template files. This is irreversible.",
    "localapp eject-template",
    ["localapp eject-template"],
  )],
  ["version", `Print the installed LocalApp version.

Usage:
  localapp version
  localapp --version
  localapp -V
`],
]);

export function resolveHelpTopic(path: string[]): LocalAppHelpTopic | undefined {
  return TOPICS.get(path.join(" "));
}

export function renderHelp(topic: LocalAppHelpTopic): string {
  const help = HELP.get(topic);
  if (help === undefined) throw new Error(`Missing LocalApp help topic: ${topic}`);
  return help;
}

export function helpHint(argv: string[]): string {
  const parent = argv[0] === "server" || argv[0] === "app" ? argv[0] : undefined;
  const commandPath = parent !== undefined
    ? argv.slice(0, 2).filter((value) => value !== undefined && !value.startsWith("-"))
    : argv.slice(0, 1).filter((value) => !value.startsWith("-"));
  const topic = resolveHelpTopic(commandPath);
  if (topic === undefined && parent !== undefined) return `Run 'localapp ${parent} --help' for usage.`;
  if (topic === undefined || topic === "root") return "Run 'localapp --help' for usage.";
  return `Run 'localapp ${commandPath.join(" ")} --help' for usage.`;
}

function noOptionsHelp(description: string, usage: string, examples: string[]): string {
  return `${description}

Usage:
  ${usage}

Options:
  -h, --help   Show this help

${examples.length === 1 ? "Example" : "Examples"}:
${examples.map((example) => `  ${example}`).join("\n")}
`;
}

function profileHelp(description: string, command: "logout" | "whoami"): string {
  return `${description}

Usage:
  localapp ${command} [options]

Options:
  --profile <name>   Use the named Server profile
  -h, --help         Show this help

Example:
  localapp ${command} --profile office
`;
}

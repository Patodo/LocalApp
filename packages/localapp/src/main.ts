import { LocalAppArgumentError, parseLocalAppArgs } from "./cli/args.js";
import { defaultCliIo, type CliIo, writeStructuredError } from "./cli/output.js";
import { login } from "./commands/login.js";
import { logout } from "./commands/logout.js";
import { whoami } from "./commands/whoami.js";
import { initializeProject } from "./commands/init.js";
import { syncManagedTemplate } from "./commands/sync-template.js";
import { ejectManagedTemplate } from "./commands/eject-template.js";
import { check } from "./commands/check.js";
import { buildPackage } from "./commands/build.js";
import { installApplication } from "./commands/app-install.js";
import { syncApplication } from "./commands/app-sync.js";
import { writeCredentialSafeJson } from "./commands/shared.js";
import { resolveProjectTarget } from "./project/target.js";
import { loadPackageVersion } from "./version.js";
import { LocalAppLifecycleError } from "./errors.js";
import { runDev } from "./commands/dev.js";
import { runServerCommand, runServerForeground } from "./commands/server.js";
import { LocalAppDaemon } from "./daemon/daemon.js";
import { createRuntimeLayout } from "./daemon/runtime-layout.js";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

export async function runLocalApp(argv: string[], io: CliIo = defaultCliIo()): Promise<number> {
  try {
    const command = parseLocalAppArgs(argv);
    if (command.kind === "version") {
      io.stdout(`localapp ${await loadPackageVersion()}\n`);
    } else if (command.kind === "help") {
      io.stdout("Usage: localapp <command>\n");
    } else if (command.kind === "login") {
      return login(command, io);
    } else if (command.kind === "logout") {
      return logout(command, io);
    } else if (command.kind === "whoami") {
      return whoami(command, io);
    } else if (command.kind === "init") {
      const name = command.name ?? path.basename(process.cwd());
      await initializeProject({ cwd: process.cwd(), name, skipInstall: command.skipInstall, skipDeploy: command.skipDeploy, io });
    } else if (command.kind === "sync-template") {
      const result = await syncManagedTemplate(process.cwd(), command);
      if (!command.quiet) io.stdout(`${JSON.stringify({ success: true, ...result })}\n`);
    } else if (command.kind === "eject-template") {
      const result = await ejectManagedTemplate(process.cwd());
      io.stdout(`${JSON.stringify({ success: true, ...result })}\n`);
    } else if (command.kind === "check") {
      return check(io, command.json);
    } else if (command.kind === "build-package") {
      return buildPackage(command.output, io);
    } else if (command.kind === "app-install") {
      const projectDir = process.cwd();
      const result = await installApplication({ projectDir, target: command.target, packagePath: command.packagePath });
      const profile = await resolveProjectTarget({ projectDir, target: command.target });
      writeCredentialSafeJson(io, { success: true, ...result }, profile.apiKey);
    } else if (command.kind === "app-sync") {
      const projectDir = process.cwd();
      const job = await syncApplication({
        projectDir, target: command.target, peer: command.peer,
        withData: command.withData, confirmation: command.confirmation,
      });
      const profile = await resolveProjectTarget({ projectDir, target: command.target });
      writeCredentialSafeJson(io, {
        success: true, status: job.status, job, sourceServer: profile.serverUrl,
        peer: command.peer, withData: command.withData,
      }, profile.apiKey);
    } else if (command.kind === "dev") {
      return await runDev({ projectDir: process.cwd(), signal: new AbortController().signal, io });
    } else if (command.kind === "server-start") {
      io.stdout(`${JSON.stringify(await runServerCommand({ action: "start" }))}\n`);
    } else if (command.kind === "server-control") {
      io.stdout(`${JSON.stringify(await runServerCommand({ action: command.action }))}\n`);
    } else if (command.kind === "server-run") {
      return await runServerForeground(command);
    } else if (command.kind === "daemon") {
      const layout = createRuntimeLayout({
        supportDir: process.env.LOCALAPP_SUPPORT_DIR,
        runtimeDir: process.env.LOCALAPP_RUNTIME_DIR,
        dataDir: process.env.LOCALAPP_DATA_DIR,
      });
      const daemon = new LocalAppDaemon({ layout });
      const stop = () => { void daemon.stop().catch(() => undefined); };
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
      await daemon.start();
      await daemon.stopped;
    }
    return 0;
  } catch (error) {
    if (error instanceof LocalAppArgumentError || error instanceof LocalAppLifecycleError) {
      writeStructuredError(io, {
        code: error.code,
        message: error.message,
        ...(error instanceof LocalAppArgumentError && error.option !== undefined ? { option: error.option } : {}),
      });
      return 1;
    }
    writeStructuredError(io, { code: "command_failed", message: "LocalApp command failed" });
    return 1;
  }
}

if (process.argv[1] !== undefined && isMainModule(fileURLToPath(import.meta.url), process.argv[1])) {
  runLocalApp(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}

function isMainModule(modulePath: string, invokedPath: string): boolean {
  try {
    return fs.realpathSync(modulePath) === fs.realpathSync(invokedPath);
  } catch {
    return path.resolve(modulePath) === path.resolve(invokedPath);
  }
}

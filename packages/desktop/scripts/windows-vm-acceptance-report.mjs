import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const requiredTrueFields = [
  "windowsX64",
  "nonAdministrator",
  "noSystemNode",
  "noSystemNpm",
  "disconnectedRequired",
  "disconnectedAtInstall",
  "webView2AbsenceRequired",
  "webView2AbsentBeforeInstall",
  "currentUserInstall",
  "packagedRuntime",
  "protocolRegistered",
  "startupStable",
  "interactiveChecksRequested",
  "upgradeStatePreserved",
  "uninstallStatePreserved",
];

const requiredManualChecks = [
  "offlineLaunch",
  "notifications",
  "favorites",
  "protocolActivation",
  "trustedAction",
  "twoLocalApps",
  "processTreeCancellation",
  "registryProxy",
  "signedUpdater",
  "autostartAndTray",
];

export function validateWindowsAcceptanceReport(report) {
  if (!report || typeof report !== "object" || Array.isArray(report)) {
    throw new Error("Windows acceptance report must be a JSON object");
  }
  if (report.status !== "passed") {
    throw new Error("Windows acceptance report status must be passed");
  }
  if (!/^[a-f0-9]{64}$/i.test(report.installerSha256 ?? "")) {
    throw new Error("installerSha256 must contain 64 hexadecimal characters");
  }
  for (const field of requiredTrueFields) {
    if (report[field] !== true) {
      const message = field === "webView2AbsentBeforeInstall"
        ? "WebView2 must be absent before installation"
        : `${field} must be true`;
      throw new Error(message);
    }
  }
  if (
    typeof report.webView2VersionAfterInstall !== "string" ||
    report.webView2VersionAfterInstall.trim() === "" ||
    report.webView2VersionAfterInstall === "0.0.0.0"
  ) {
    throw new Error("webView2VersionAfterInstall must contain the installed Runtime version");
  }
  if (!report.manualChecks || typeof report.manualChecks !== "object") {
    throw new Error("manualChecks must be present");
  }
  for (const check of requiredManualChecks) {
    if (report.manualChecks[check] !== "passed") {
      throw new Error(`${check} must be passed`);
    }
  }
  return { valid: true, checks: requiredTrueFields.length + requiredManualChecks.length + 2 };
}

async function main() {
  const reportPath = process.argv[2];
  if (!reportPath) throw new Error("Usage: node windows-vm-acceptance-report.mjs <report.json>");
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  const result = validateWindowsAcceptanceReport(report);
  process.stdout.write(`Windows VM acceptance report passed ${result.checks} evidence checks.\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

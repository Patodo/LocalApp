import assert from "node:assert/strict";
import test from "node:test";

import { validateWindowsAcceptanceReport } from "./windows-vm-acceptance-report.mjs";

const validReport = {
  status: "passed",
  installerSha256: "a".repeat(64),
  windowsX64: true,
  nonAdministrator: true,
  noSystemNode: true,
  noSystemNpm: true,
  disconnectedRequired: true,
  disconnectedAtInstall: true,
  webView2AbsenceRequired: true,
  webView2AbsentBeforeInstall: true,
  webView2VersionAfterInstall: "138.0.3351.83",
  currentUserInstall: true,
  packagedRuntime: true,
  protocolRegistered: true,
  startupStable: true,
  interactiveChecksRequested: true,
  upgradeStatePreserved: true,
  uninstallStatePreserved: true,
  manualChecks: {
    offlineLaunch: "passed",
    notifications: "passed",
    favorites: "passed",
    protocolActivation: "passed",
    trustedAction: "passed",
    twoLocalApps: "passed",
    processTreeCancellation: "passed",
    registryProxy: "passed",
    signedUpdater: "passed",
    autostartAndTray: "passed",
  },
};

test("accepts a complete interactive Windows VM report", () => {
  assert.deepEqual(validateWindowsAcceptanceReport(validReport), {
    valid: true,
    checks: 27,
  });
});

test("rejects automation-only and incomplete Windows evidence", () => {
  assert.throws(
    () => validateWindowsAcceptanceReport({ ...validReport, status: "automation-passed-manual-not-run" }),
    /status must be passed/,
  );
  assert.throws(
    () => validateWindowsAcceptanceReport({ ...validReport, webView2AbsentBeforeInstall: false }),
    /WebView2 must be absent before installation/,
  );
  assert.throws(
    () => validateWindowsAcceptanceReport({
      ...validReport,
      manualChecks: { ...validReport.manualChecks, processTreeCancellation: "not-run" },
    }),
    /processTreeCancellation must be passed/,
  );
});

test("requires clean Windows VM, upgrade, uninstall, offline, and fixed-runtime evidence", () => {
  for (const field of [
    "windowsX64",
    "nonAdministrator",
    "noSystemNode",
    "noSystemNpm",
    "upgradeStatePreserved",
    "uninstallStatePreserved",
    "disconnectedRequired",
    "disconnectedAtInstall",
    "webView2AbsenceRequired",
    "packagedRuntime",
  ]) {
    assert.throws(
      () => validateWindowsAcceptanceReport({ ...validReport, [field]: false }),
      new RegExp(field),
    );
  }
});

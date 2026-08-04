import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  compareReports,
  summarizeRuns,
  validateCatalog,
  validateRun,
} from "../lib/agent-first-run-benchmark.mjs";

const root = path.resolve(import.meta.dirname, "../..");

function run(overrides = {}) {
  const phase = {
    firstAttempt: "passed",
    finalResult: "passed",
    durationMs: 100,
    attempts: 1,
    retryCount: 0,
    diagnosticCodes: [],
  };
  return {
    schemaVersion: 1,
    runId: "run-basic-crud-001",
    requirementId: "basic-team-crud",
    mode: "agent",
    platformVersion: "1.2.0",
    cliVersion: "0.416.6",
    startedAt: "2026-07-19T00:00:00.000Z",
    finishedAt: "2026-07-19T00:01:00.000Z",
    firstVisibleMs: 30_000,
    phases: {
      check: { ...phase },
      build: { ...phase },
      upload: { ...phase },
      verify: { ...phase },
    },
    repairCount: 0,
    outcome: "passed",
    ...overrides,
  };
}

test("run validation requires every first-attempt phase result", () => {
  const candidate = run();
  delete candidate.phases.verify.firstAttempt;

  assert.throws(() => validateRun(candidate), /phases\.verify\.firstAttempt/);
});

test("run validation requires timing, diagnostics, retries, and consistent attempts", () => {
  const candidate = run();
  candidate.phases.upload = {
    firstAttempt: "failed",
    finalResult: "passed",
    durationMs: -1,
    attempts: 2,
    retryCount: 0,
    diagnosticCodes: "UPLOAD_FAILED",
  };

  assert.throws(
    () => validateRun(candidate),
    /durationMs|diagnosticCodes|retryCount/,
  );
});

test("run validation rejects unknown protocol fields", () => {
  assert.throws(() => validateRun(run({ retry: 1 })), /unknown fields: retry/);
});

test("run and catalog validation reject duplicate unique-list entries", () => {
  const candidate = run();
  candidate.phases.check.diagnosticCodes = ["APP_TEST_FAILED", "APP_TEST_FAILED"];
  assert.throws(() => validateRun(candidate), /diagnosticCodes must contain unique strings/);

  const catalog = JSON.parse(fs.readFileSync(
    path.join(root, "benchmarks/agent-first-run/catalog.json"),
    "utf8",
  ));
  catalog.requirements[0].requiredCapabilities.push(catalog.requirements[0].requiredCapabilities[0]);
  assert.throws(() => validateCatalog(catalog), /requiredCapabilities must contain unique strings/);
});

test("catalog validation enforces its schema marker and stable identifiers", () => {
  const catalog = JSON.parse(fs.readFileSync(
    path.join(root, "benchmarks/agent-first-run/catalog.json"),
    "utf8",
  ));

  const missingSchema = structuredClone(catalog);
  delete missingSchema.$schema;
  assert.throws(() => validateCatalog(missingSchema), /catalog\.\$schema/);

  const invalidVersion = structuredClone(catalog);
  invalidVersion.benchmarkSetVersion = "release-1";
  assert.throws(() => validateCatalog(invalidVersion), /benchmarkSetVersion must be semantic version/);

  const invalidId = structuredClone(catalog);
  invalidId.requirements[0].id = "Invalid requirement";
  assert.throws(() => validateCatalog(invalidId), /requirements\[0\]\.id must match/);
});

test("catalog covers all representative application categories", () => {
  const catalog = JSON.parse(fs.readFileSync(
    path.join(root, "benchmarks/agent-first-run/catalog.json"),
    "utf8",
  ));

  const validated = validateCatalog(catalog);
  assert.deepEqual(
    new Set(validated.requirements.map((entry) => entry.category)),
    new Set([
      "basic-crud",
      "personal-ownership",
      "approval-transition",
      "image-pdf-content",
      "aggregate-pagination",
      "multi-table-complex",
    ]),
  );
  for (const requirement of validated.requirements) {
    assert.ok(requirement.acceptance.length >= 3);
    assert.ok(requirement.verificationIdentities.includes("owner"));
  }
});

test("summaries preserve first delivery success and retry metrics", () => {
  const failedFirstUpload = run({
    runId: "run-basic-crud-002",
    phases: {
      ...run().phases,
      upload: {
        firstAttempt: "failed",
        finalResult: "passed",
        durationMs: 500,
        attempts: 2,
        retryCount: 1,
        diagnosticCodes: ["UPLOAD_FAILED"],
      },
    },
    repairCount: 1,
  });

  const report = summarizeRuns([run(), failedFirstUpload], {
    benchmarkSetVersion: "1.0.0",
    generatedAt: "2026-07-19T00:02:00.000Z",
  });

  assert.equal(report.summary.completedRuns, 2);
  assert.equal(report.summary.firstDeliveryPassed, 1);
  assert.equal(report.summary.firstDeliverySuccessRate, 0.5);
  assert.equal(report.summary.totalRetries, 1);
  assert.equal(report.summary.totalRepairs, 1);
});

test("comparison flags requirement and aggregate regressions", () => {
  const baseline = summarizeRuns([run()], {
    benchmarkSetVersion: "1.0.0",
    generatedAt: "2026-07-19T00:02:00.000Z",
  });
  const regressedRun = run({
    runId: "run-basic-crud-regressed",
    firstVisibleMs: 90_000,
    phases: {
      ...run().phases,
      verify: {
        firstAttempt: "failed",
        finalResult: "failed",
        durationMs: 300,
        attempts: 1,
        retryCount: 0,
        diagnosticCodes: ["VERIFY_FAILED"],
      },
    },
    repairCount: 2,
    outcome: "failed",
  });
  const current = summarizeRuns([regressedRun], {
    benchmarkSetVersion: "1.0.0",
    generatedAt: "2026-07-19T00:03:00.000Z",
  });

  const comparison = compareReports(current, baseline);
  assert.equal(comparison.regressed, true);
  assert.ok(comparison.reasons.some((reason) => reason.code === "FIRST_DELIVERY_RATE_REGRESSION"));
  assert.ok(comparison.reasons.some((reason) => reason.requirementId === "basic-team-crud"));
});

test("record, summarize, and compare commands form a machine-readable workflow", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "localapp-benchmark-"));
  const input = path.join(temp, "input.json");
  const runs = path.join(temp, "runs");
  const recorded = path.join(runs, "run.json");
  const report = path.join(temp, "report.json");
  fs.writeFileSync(input, JSON.stringify(run()));

  const record = benchmarkCommand(["record", "--input", input, "--output", recorded]);
  assert.equal(record.status, 0, record.stderr);
  assert.equal(JSON.parse(record.stdout).success, true);

  const summarize = benchmarkCommand([
    "summarize", "--input-dir", runs, "--output", report, "--allow-partial",
  ]);
  assert.equal(summarize.status, 0, summarize.stderr);
  assert.equal(JSON.parse(summarize.stdout).summary.firstDeliverySuccessRate, 1);

  const compare = benchmarkCommand([
    "compare", "--current", report, "--baseline", report, "--allow-partial",
  ]);
  assert.equal(compare.status, 0, compare.stderr);
  assert.equal(JSON.parse(compare.stdout).regressed, false);
  fs.rmSync(temp, { recursive: true, force: true });
});

function benchmarkCommand(args) {
  return spawnSync(process.execPath, [
    path.join(root, "scripts/agent-first-run-benchmark.mjs"),
    ...args,
  ], { cwd: root, encoding: "utf8" });
}

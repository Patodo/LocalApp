#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import {
  compareReports,
  summarizeRuns,
  validateCatalog,
  validateReport,
  validateRun,
} from "./lib/agent-first-run-benchmark.mjs";

const root = path.resolve(import.meta.dirname, "..");
const benchmarkDir = path.join(root, "benchmarks/agent-first-run");
const catalogPath = path.join(benchmarkDir, "catalog.json");

async function main() {
  const [command = "validate", ...args] = process.argv.slice(2);
  const flags = parseFlags(args);
  const catalog = readJson(catalogPath);
  validateCatalog(catalog);
  validateSchemaDocuments();

  if (command === "validate") {
    const input = flags.get("input");
    if (input) validateInput(readJson(resolvePath(input)));
    writeProtocol({ success: true, command, benchmarkSetVersion: catalog.benchmarkSetVersion });
    return;
  }

  if (command === "record") {
    const input = requiredFlag(flags, "input");
    const run = validateRun(readJson(resolvePath(input)));
    if (!catalog.requirements.some((requirement) => requirement.id === run.requirementId)) {
      throw new Error(`Unknown requirementId ${run.requirementId}`);
    }
    const output = resolvePath(
      flags.get("output") ?? path.join(benchmarkDir, "runs", `${run.runId}.json`),
    );
    writeJson(output, run);
    writeProtocol({ success: true, command, output: relative(output), runId: run.runId });
    return;
  }

  if (command === "summarize") {
    const inputDir = resolvePath(requiredFlag(flags, "input-dir"));
    const runs = fs.readdirSync(inputDir)
      .filter((name) => name.endsWith(".json"))
      .sort()
      .map((name) => readJson(path.join(inputDir, name)));
    const report = summarizeRuns(runs, {
      benchmarkSetVersion: catalog.benchmarkSetVersion,
      generatedAt: new Date().toISOString(),
    });
    if (!flags.has("allow-partial")) requireCompleteCatalog(report, catalog);
    const output = resolvePath(requiredFlag(flags, "output"));
    writeJson(output, report);
    writeProtocol({ success: true, command, output: relative(output), summary: report.summary });
    return;
  }

  if (command === "compare") {
    const current = readJson(resolvePath(requiredFlag(flags, "current")));
    const baseline = readJson(resolvePath(requiredFlag(flags, "baseline")));
    if (!flags.has("allow-partial")) {
      requireCompleteCatalog(current, catalog);
      requireCompleteCatalog(baseline, catalog);
    }
    const comparison = compareReports(current, baseline);
    const output = flags.get("output");
    if (output) writeJson(resolvePath(output), comparison);
    writeProtocol(comparison);
    if (comparison.regressed) process.exitCode = 1;
    return;
  }

  if (command === "deterministic") {
    const report = runDeterministicSuite();
    const output = flags.get("output");
    if (output) writeJson(resolvePath(output), report);
    writeProtocol(report);
    if (!report.success) process.exitCode = 1;
    return;
  }

  throw new Error(`Unknown command ${command}`);
}

function runDeterministicSuite() {
  const suite = readJson(path.join(benchmarkDir, "deterministic-suite.json"));
  const startedAt = new Date().toISOString();
  const checks = [];
  for (const check of suite.checks) {
    if (/codex|claude|openai/i.test([check.command, ...check.args].join(" "))) {
      throw new Error(`Deterministic check ${check.id} must not invoke an Agent or paid API`);
    }
    const started = performance.now();
    const result = spawnSync(check.command, check.args, {
      cwd: root,
      encoding: "utf8",
      env: process.env,
    });
    const status = result.status === 0 ? "passed" : "failed";
    const detail = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    process.stderr.write(`[${status.toUpperCase()}] ${check.id}\n`);
    if (status === "failed" && detail) process.stderr.write(`${detail}\n`);
    checks.push({
      id: check.id,
      status,
      durationMs: Math.round(performance.now() - started),
      command: [check.command, ...check.args].join(" "),
      ...(status === "failed" ? { detail } : {}),
    });
    if (status === "failed") break;
  }
  const capabilities = readJson(path.join(root, "platform/capabilities.json"));
  const cliVersion = readJson(path.join(root, "packages/localapp/package.json")).version ?? "unknown";
  return {
    schemaVersion: 1,
    mode: "deterministic",
    success: checks.length === suite.checks.length && checks.every((check) => check.status === "passed"),
    startedAt,
    finishedAt: new Date().toISOString(),
    platformVersion: capabilities.platformVersion,
    cliVersion,
    checks,
  };
}

function validateInput(value) {
  if (Array.isArray(value?.results)) return validateReport(value);
  return validateRun(value);
}

function validateSchemaDocuments() {
  for (const name of ["catalog.schema.json", "run.schema.json", "report.schema.json"]) {
    const schema = readJson(path.join(benchmarkDir, "schemas", name));
    if (schema.$schema !== "https://json-schema.org/draft/2020-12/schema") {
      throw new Error(`${name} must use JSON Schema draft 2020-12`);
    }
    if (schema.type !== "object" || schema.additionalProperties !== false) {
      throw new Error(`${name} must define a strict object schema`);
    }
  }
}

function requireCompleteCatalog(reportValue, catalog) {
  const report = validateReport(reportValue);
  const present = new Set(report.results.map((run) => run.requirementId));
  const missing = catalog.requirements
    .map((requirement) => requirement.id)
    .filter((id) => !present.has(id));
  if (missing.length > 0) throw new Error(`Report is missing benchmark requirements: ${missing.join(", ")}`);
}

function parseFlags(args) {
  const flags = new Map();
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith("--")) throw new Error(`Unexpected argument ${token}`);
    const name = token.slice(2);
    const next = args[index + 1];
    if (!next || next.startsWith("--")) {
      flags.set(name, true);
    } else {
      flags.set(name, next);
      index += 1;
    }
  }
  return flags;
}

function requiredFlag(flags, name) {
  const value = flags.get(name);
  if (typeof value !== "string") throw new Error(`--${name} is required`);
  return value;
}

function resolvePath(value) {
  return path.isAbsolute(value) ? value : path.join(root, value);
}

function relative(value) {
  return path.relative(root, value) || ".";
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function writeProtocol(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ success: false, error: error.message })}\n`);
  process.exitCode = 1;
});

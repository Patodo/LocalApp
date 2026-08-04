const PHASE_NAMES = ["check", "build", "upload", "verify"];
const PHASE_RESULTS = new Set(["passed", "failed", "not-run"]);
const CATEGORIES = new Set([
  "basic-crud",
  "personal-ownership",
  "approval-transition",
  "image-pdf-content",
  "aggregate-pagination",
  "multi-table-complex",
]);

export function validateRun(value) {
  const run = object(value, "run");
  onlyKeys(run, new Set([
    "schemaVersion", "runId", "requirementId", "mode", "platformVersion", "cliVersion",
    "startedAt", "finishedAt", "firstVisibleMs", "phases", "repairCount", "outcome",
    "source", "notes",
  ]), "run");
  integer(run.schemaVersion, "schemaVersion", 1);
  if (run.schemaVersion !== 1) fail("schemaVersion must be 1");
  string(run.runId, "runId");
  string(run.requirementId, "requirementId");
  member(run.mode, new Set(["agent"]), "mode");
  string(run.platformVersion, "platformVersion");
  string(run.cliVersion, "cliVersion");
  timestamp(run.startedAt, "startedAt");
  timestamp(run.finishedAt, "finishedAt");
  if (Date.parse(run.finishedAt) < Date.parse(run.startedAt)) {
    fail("finishedAt must not precede startedAt");
  }
  integer(run.firstVisibleMs, "firstVisibleMs", 0);
  const phases = object(run.phases, "phases");
  for (const phaseName of PHASE_NAMES) validatePhase(phases[phaseName], `phases.${phaseName}`);
  integer(run.repairCount, "repairCount", 0);
  member(run.outcome, new Set(["passed", "failed"]), "outcome");
  if (run.outcome === "passed" && PHASE_NAMES.some((name) => phases[name].finalResult !== "passed")) {
    fail("outcome passed requires every phase finalResult to be passed");
  }
  if (run.source !== undefined) {
    const source = object(run.source, "source");
    onlyKeys(source, new Set(["threadId", "commit", "appPath"]), "source");
    for (const key of ["threadId", "commit", "appPath"]) {
      if (source[key] !== undefined) string(source[key], `source.${key}`);
    }
  }
  if (run.notes !== undefined) string(run.notes, "notes");
  return run;
}

function validatePhase(value, name) {
  const phase = object(value, name);
  onlyKeys(phase, new Set([
    "firstAttempt", "finalResult", "durationMs", "attempts", "retryCount", "diagnosticCodes",
  ]), name);
  member(phase.firstAttempt, PHASE_RESULTS, `${name}.firstAttempt`);
  member(phase.finalResult, PHASE_RESULTS, `${name}.finalResult`);
  integer(phase.durationMs, `${name}.durationMs`, 0);
  integer(phase.attempts, `${name}.attempts`, 0);
  integer(phase.retryCount, `${name}.retryCount`, 0);
  stringArray(phase.diagnosticCodes, `${name}.diagnosticCodes`, 0, true);
  if (phase.retryCount !== Math.max(0, phase.attempts - 1)) {
    fail(`${name}.retryCount must equal attempts - 1`);
  }
  if (phase.firstAttempt === "not-run" && phase.attempts !== 0) {
    fail(`${name}.attempts must be 0 when firstAttempt is not-run`);
  }
  if (phase.firstAttempt !== "not-run" && phase.attempts < 1) {
    fail(`${name}.attempts must be at least 1 when the phase ran`);
  }
}

export function validateCatalog(value) {
  const catalog = object(value, "catalog");
  onlyKeys(catalog, new Set(["$schema", "schemaVersion", "benchmarkSetVersion", "requirements"]), "catalog");
  string(catalog.$schema, "catalog.$schema");
  integer(catalog.schemaVersion, "schemaVersion", 1);
  string(catalog.benchmarkSetVersion, "benchmarkSetVersion");
  if (!/^\d+\.\d+\.\d+$/.test(catalog.benchmarkSetVersion)) {
    fail("benchmarkSetVersion must be semantic version major.minor.patch");
  }
  if (!Array.isArray(catalog.requirements) || catalog.requirements.length === 0) {
    fail("requirements must be a non-empty array");
  }
  const ids = new Set();
  const categories = new Set();
  for (const [index, candidate] of catalog.requirements.entries()) {
    const name = `requirements[${index}]`;
    const requirement = object(candidate, name);
    onlyKeys(requirement, new Set([
      "id", "category", "title", "prompt", "requiredCapabilities",
      "verificationIdentities", "acceptance",
    ]), name);
    string(requirement.id, `${name}.id`);
    if (!/^[a-z][a-z0-9-]+$/.test(requirement.id)) {
      fail(`${name}.id must match ^[a-z][a-z0-9-]+$`);
    }
    if (ids.has(requirement.id)) fail(`${name}.id must be unique`);
    ids.add(requirement.id);
    member(requirement.category, CATEGORIES, `${name}.category`);
    categories.add(requirement.category);
    string(requirement.title, `${name}.title`);
    string(requirement.prompt, `${name}.prompt`);
    stringArray(requirement.requiredCapabilities, `${name}.requiredCapabilities`, 1, true);
    stringArray(requirement.verificationIdentities, `${name}.verificationIdentities`, 1, true);
    for (const identity of requirement.verificationIdentities) {
      member(identity, new Set(["owner", "member"]), `${name}.verificationIdentities`);
    }
    stringArray(requirement.acceptance, `${name}.acceptance`, 3);
  }
  for (const category of CATEGORIES) {
    if (!categories.has(category)) fail(`catalog is missing category ${category}`);
  }
  return catalog;
}

export function summarizeRuns(values, metadata) {
  if (!Array.isArray(values) || values.length === 0) fail("runs must be a non-empty array");
  const runs = values.map(validateRun);
  string(metadata?.benchmarkSetVersion, "benchmarkSetVersion");
  timestamp(metadata?.generatedAt, "generatedAt");
  const firstDeliveryPassed = runs.filter(firstDeliverySucceeded).length;
  const firstVisible = runs.map((run) => run.firstVisibleMs).sort((a, b) => a - b);
  const totalRetries = runs.reduce(
    (sum, run) => sum + PHASE_NAMES.reduce((phaseSum, phase) => phaseSum + run.phases[phase].retryCount, 0),
    0,
  );
  const totalRepairs = runs.reduce((sum, run) => sum + run.repairCount, 0);
  return {
    schemaVersion: 1,
    benchmarkSetVersion: metadata.benchmarkSetVersion,
    generatedAt: metadata.generatedAt,
    platformVersion: commonOrMixed(runs.map((run) => run.platformVersion)),
    cliVersion: commonOrMixed(runs.map((run) => run.cliVersion)),
    summary: {
      completedRuns: runs.length,
      passedRuns: runs.filter((run) => run.outcome === "passed").length,
      firstDeliveryPassed,
      firstDeliverySuccessRate: firstDeliveryPassed / runs.length,
      medianFirstVisibleMs: median(firstVisible),
      totalRetries,
      totalRepairs,
    },
    results: runs,
  };
}

export function validateReport(value) {
  const report = object(value, "report");
  onlyKeys(report, new Set([
    "schemaVersion", "benchmarkSetVersion", "generatedAt", "platformVersion", "cliVersion",
    "summary", "results",
  ]), "report");
  integer(report.schemaVersion, "schemaVersion", 1);
  string(report.benchmarkSetVersion, "benchmarkSetVersion");
  timestamp(report.generatedAt, "generatedAt");
  string(report.platformVersion, "platformVersion");
  string(report.cliVersion, "cliVersion");
  if (!Array.isArray(report.results)) fail("results must be an array");
  const regenerated = summarizeRuns(report.results, {
    benchmarkSetVersion: report.benchmarkSetVersion,
    generatedAt: report.generatedAt,
  });
  if (JSON.stringify(regenerated.summary) !== JSON.stringify(report.summary)) {
    fail("summary does not match results");
  }
  if (report.platformVersion !== regenerated.platformVersion || report.cliVersion !== regenerated.cliVersion) {
    fail("report versions do not match results");
  }
  return report;
}

export function compareReports(currentValue, baselineValue) {
  const current = validateReport(currentValue);
  const baseline = validateReport(baselineValue);
  if (current.benchmarkSetVersion !== baseline.benchmarkSetVersion) {
    fail("benchmarkSetVersion must match before comparison");
  }
  const reasons = [];
  if (current.summary.firstDeliverySuccessRate < baseline.summary.firstDeliverySuccessRate) {
    reasons.push({
      code: "FIRST_DELIVERY_RATE_REGRESSION",
      baseline: baseline.summary.firstDeliverySuccessRate,
      current: current.summary.firstDeliverySuccessRate,
    });
  }
  if (
    current.summary.medianFirstVisibleMs - baseline.summary.medianFirstVisibleMs >= 30_000
    && current.summary.medianFirstVisibleMs > baseline.summary.medianFirstVisibleMs * 1.2
  ) {
    reasons.push({
      code: "FIRST_VISIBLE_TIME_REGRESSION",
      baseline: baseline.summary.medianFirstVisibleMs,
      current: current.summary.medianFirstVisibleMs,
    });
  }
  const baselineRepairs = baseline.summary.totalRepairs / baseline.summary.completedRuns;
  const currentRepairs = current.summary.totalRepairs / current.summary.completedRuns;
  if (currentRepairs > baselineRepairs + 0.5) {
    reasons.push({
      code: "REPAIR_COUNT_REGRESSION",
      baseline: baselineRepairs,
      current: currentRepairs,
    });
  }
  const baselineFirst = firstDeliveryByRequirement(baseline.results);
  const currentFirst = firstDeliveryByRequirement(current.results);
  for (const [requirementId, passed] of baselineFirst) {
    if (passed && currentFirst.get(requirementId) === false) {
      reasons.push({ code: "REQUIREMENT_FIRST_DELIVERY_REGRESSION", requirementId });
    }
  }
  return {
    schemaVersion: 1,
    benchmarkSetVersion: current.benchmarkSetVersion,
    regressed: reasons.length > 0,
    reasons,
    baseline: baseline.summary,
    current: current.summary,
  };
}

export function firstDeliverySucceeded(run) {
  return PHASE_NAMES.every((name) => run.phases[name].firstAttempt === "passed");
}

function firstDeliveryByRequirement(runs) {
  const grouped = new Map();
  for (const run of runs) {
    const passed = firstDeliverySucceeded(run);
    grouped.set(run.requirementId, (grouped.get(run.requirementId) ?? false) || passed);
  }
  return grouped;
}

function commonOrMixed(values) {
  return values.every((value) => value === values[0]) ? values[0] : "mixed";
}

function median(values) {
  const middle = Math.floor(values.length / 2);
  return values.length % 2 === 0 ? (values[middle - 1] + values[middle]) / 2 : values[middle];
}

function object(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${name} must be an object`);
  return value;
}

function string(value, name) {
  if (typeof value !== "string" || value.length === 0) fail(`${name} must be a non-empty string`);
}

function timestamp(value, name) {
  string(value, name);
  if (!Number.isFinite(Date.parse(value))) fail(`${name} must be an ISO timestamp`);
}

function integer(value, name, minimum) {
  if (!Number.isInteger(value) || value < minimum) fail(`${name} must be an integer >= ${minimum}`);
}

function member(value, allowed, name) {
  if (!allowed.has(value)) fail(`${name} has unsupported value ${String(value)}`);
}

function stringArray(value, name, minimumLength, unique = false) {
  if (!Array.isArray(value) || value.length < minimumLength || value.some((item) => typeof item !== "string" || !item)) {
    fail(`${name} must contain at least ${minimumLength} non-empty strings`);
  }
  if (unique && new Set(value).size !== value.length) {
    fail(`${name} must contain unique strings`);
  }
}

function onlyKeys(value, allowed, name) {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) fail(`${name} contains unknown fields: ${unknown.join(", ")}`);
}

function fail(message) {
  throw new Error(message);
}

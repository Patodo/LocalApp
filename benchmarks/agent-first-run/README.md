# Agent First-Run Benchmark

This benchmark measures two separate outcomes:

- `firstVisibleMs`: elapsed time from application initialization until the first interactive version is visible.
- First delivery success: every `check`, `build`, `upload`, and `verify` phase passes on its first attempt.

The catalog contains six stable requirements. Do not change an existing requirement during a release comparison; bump `benchmarkSetVersion` when acceptance semantics change.

## Ordinary CI

Run the deterministic platform suite without an Agent or paid API:

```bash
pnpm test:platform-regression
```

It checks the capability contract, dev/production content behavior, production verification isolation, and the benchmark protocol. This is the only benchmark layer that blocks ordinary CI.

## Controlled Agent Run

For a scheduled or release-time Agent run, record timestamps and every phase attempt while the application task is being executed. The submitted JSON must satisfy `schemas/run.schema.json`; failed runs are records too and must not be discarded.

```bash
node scripts/agent-first-run-benchmark.mjs record \
  --input /tmp/basic-team-crud-run.json

node scripts/agent-first-run-benchmark.mjs summarize \
  --input-dir benchmarks/agent-first-run/runs \
  --output /tmp/current-report.json

node scripts/agent-first-run-benchmark.mjs compare \
  --current /tmp/current-report.json \
  --baseline benchmarks/agent-first-run/baselines/approved.json
```

Use `--allow-partial` only for application smoke reports such as `outer-ai-usage` and `team-workload`. A release comparison requires all six requirement IDs.

Promote a report to `baselines/approved.json` only after reviewing its source tasks, application commits, diagnostic codes, and production verification evidence. Never manufacture missing timings or replace a failed first attempt with the repaired result.

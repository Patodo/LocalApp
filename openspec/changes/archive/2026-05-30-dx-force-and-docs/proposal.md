# DX: --force flag and /serve/ doc cleanup

## Problem
1. `localapp init` fails with "Page name already exists" when re-running in same project
2. `localapp schemas create` fails with "Schema already exists" — no way to update
3. `/serve/` internal URL prefix exposed in developer-facing documentation

## Solution
1. `init`: treat 409 as non-fatal (page already exists → reuse it)
2. `schemas create --force`: delete-then-recreate pattern
3. Skills docs: remove `/serve/` references, note that SDK handles routing automatically

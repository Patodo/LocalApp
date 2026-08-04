# Query Invalidation

## Problem
After mutations (create/update/delete), read hooks (useList, useCount, useGet) show stale data until manual refresh(). Agents and developers must remember to call refresh() after every mutation, which is error-prone.

## Solution
Add a resource-level invalidation bus in sdk-core. Mutation hooks automatically call `invalidate(resource)` after success. Read hooks subscribe to invalidation events and re-fetch automatically.

## Scope
- `packages/sdk-core/src/invalidate.ts` — subscribe/invalidate functions
- All read hooks subscribe via useEffect
- All mutation hooks call invalidate after onSuccess
- Tests in `init-repo/tests/invalidation.test.ts`

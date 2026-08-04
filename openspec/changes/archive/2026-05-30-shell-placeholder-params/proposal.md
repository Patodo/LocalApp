# Fix Shell Placeholder Params

## Problem
The platform shell page at `/:userId/:name` loads the iframe with `/serve/placeholder/placeholder/` instead of the actual app path. This breaks ALL public-facing app URLs.

Root cause: Next.js static export uses `generateStaticParams()` which bakes `"placeholder"` into the RSC payload. Client hydration uses these static values instead of the actual URL params.

## Solution
Server-side string replacement in `serve.ts` — replace escaped `"placeholder"` tokens with actual `userId` and `name` before serving the shell HTML.

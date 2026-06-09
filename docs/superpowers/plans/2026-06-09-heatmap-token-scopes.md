# Heatmap Token Scopes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add embeddable TokenUsage heatmaps and split API keys into read-only display tokens and read-write upload tokens.

**Architecture:** Server owns scope enforcement, daily heatmap aggregation, SVG rendering, dashboard key creation, and read-write API-key ingest. Client keeps the existing device flow and also accepts a read-write API token for direct upload from machines where browser login is inconvenient.

**Tech Stack:** TypeScript, Cloudflare Workers, D1, Vitest, local CLI TypeScript.

---

### Task 1: Server Token Scopes

**Files:**
- Create: `/Users/chunqiu/Documents/workspace/TokenUsage_Server/migrations/0003_api_key_scopes.sql`
- Create: `/Users/chunqiu/Documents/workspace/TokenUsage_Server/src/api-keys.ts`
- Modify: `/Users/chunqiu/Documents/workspace/TokenUsage_Server/src/auth.ts`
- Modify: `/Users/chunqiu/Documents/workspace/TokenUsage_Server/src/types.ts`
- Test: `/Users/chunqiu/Documents/workspace/TokenUsage_Server/test/api-keys.test.ts`

- [ ] Write failing tests for `normalizeApiKeyScope`, `apiKeyPayload`, and auth SQL exposing `scope`.
- [ ] Add D1 `scope` column with default `read_only`.
- [ ] Return API-key auth users with `api_key_id` and `api_key_scope`.
- [ ] Make key creation validate `read_only` and `read_write`.

### Task 2: Server Heatmap API and SVG Embed

**Files:**
- Create: `/Users/chunqiu/Documents/workspace/TokenUsage_Server/src/heatmap.ts`
- Modify: `/Users/chunqiu/Documents/workspace/TokenUsage_Server/src/http.ts`
- Modify: `/Users/chunqiu/Documents/workspace/TokenUsage_Server/src/index.ts`
- Test: `/Users/chunqiu/Documents/workspace/TokenUsage_Server/test/heatmap.test.ts`

- [ ] Write failing tests for daily aggregation, missing-day filling, SQL filters, and self-contained SVG output.
- [ ] Add `/api/usage/heatmap` for session or API-key read access.
- [ ] Add `/api/embed/heatmap.svg?token=tu_api_...` that accepts only `read_only` keys.
- [ ] Clamp default embed range to the last 365 days and include `metric=tokens|cost`.

### Task 3: Server Read-Write Ingest

**Files:**
- Modify: `/Users/chunqiu/Documents/workspace/TokenUsage_Server/src/index.ts`
- Test: `/Users/chunqiu/Documents/workspace/TokenUsage_Server/test/ingest-auth.test.ts`

- [ ] Write failing tests for read-only ingest rejection and read-write ingest authorization helpers.
- [ ] Keep device token ingest unchanged.
- [ ] Allow read-write API keys to upload to a deterministic per-key/per-device synthetic device.
- [ ] Reject read-only keys for upload with 403.

### Task 4: Dashboard Copy UI

**Files:**
- Modify: `/Users/chunqiu/Documents/workspace/TokenUsage_Server/src/html.ts`
- Test: `/Users/chunqiu/Documents/workspace/TokenUsage_Server/test/dashboard-html.test.ts`

- [ ] Write failing tests for the scope selector, heatmap section, SVG preview, and README markdown copy field.
- [ ] Add API key scope selection.
- [ ] Show copyable README image markdown only for read-only keys.
- [ ] Preview heatmap using the selected read-only token URL.

### Task 5: Client Read-Write Token Upload

**Files:**
- Modify: `/Users/chunqiu/Documents/workspace/TokenUsage/src/config.ts`
- Modify: `/Users/chunqiu/Documents/workspace/TokenUsage/src/api.ts`
- Modify: `/Users/chunqiu/Documents/workspace/TokenUsage/src/cli.ts`
- Modify: `/Users/chunqiu/Documents/workspace/TokenUsage/src/status.ts`
- Test: `/Users/chunqiu/Documents/workspace/TokenUsage/test/api-token.test.ts`
- Test: `/Users/chunqiu/Documents/workspace/TokenUsage/test/status.test.ts`

- [ ] Write failing tests for API-token payload metadata and status output.
- [ ] Add `tokenusage login --api-token tu_api_... --server-url ...`.
- [ ] Make `sync` use the configured upload token, with device metadata for API-key uploads.
- [ ] Keep device-token remote status checks and mark API-key status as configured.

### Task 6: Verification and Commits

- [ ] Run server migration locally.
- [ ] Run `npm test -- --run` and `npm run typecheck` in Server.
- [ ] Run `npm test -- --run` and `npm run build` in Client.
- [ ] QA dashboard heatmap and copy URL on desktop and mobile.
- [ ] Commit Server and Client changes with standard messages.

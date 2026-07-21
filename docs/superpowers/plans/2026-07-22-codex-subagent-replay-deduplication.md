# Codex Subagent Replay Deduplication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent inherited parent-thread history in Codex subagent rollout files from being counted as fresh token usage.

**Architecture:** Extend the streaming Codex parser with a small subagent replay state machine. A subagent rollout is identified from its first `session_meta.payload.source.subagent`; historical rows are observed for model and cumulative baselines but not emitted until the rollout's `inter_agent_communication_metadata` row with `trigger_turn: true`. Normal Codex rollouts retain their current behavior.

**Tech Stack:** TypeScript, Node.js 20+, Vitest, Codex JSONL rollouts.

## Global Constraints

- Preserve streaming parsing; do not read whole rollout files into memory.
- Preserve existing behavior for non-subagent Codex rollouts.
- Attribute emitted subagent events to the rollout's unique `payload.id`, not the parent `session_id`.
- Do not mutate local Codex session files or remote TokenFlow data during verification.

---

### Task 1: Add a regression test for inherited subagent history

**Files:**
- Modify: `test/codex-parser.test.ts`

**Interfaces:**
- Consumes: `parseCodexJsonl(jsonl, options): UsageEvent[]`
- Produces: A regression test proving replayed parent token rows are suppressed and the subagent's own row is emitted.

- [x] **Step 1: Write the failing test**

Add a fixture with a subagent `session_meta`, an inherited parent `session_meta`, an inherited `token_count`, a real `turn_context`, a `trigger_turn` marker, and one subagent `token_count`. Assert that only the latter event is emitted and uses the subagent rollout ID.

- [x] **Step 2: Run test to verify it fails**

Run: `npm test -- test/codex-parser.test.ts`

Expected: FAIL because the current parser emits the inherited parent token row and assigns the parent session ID.

### Task 2: Implement the streaming replay boundary

**Files:**
- Modify: `src/sources/codex.ts`

**Interfaces:**
- Consumes: Codex JSONL rows passed one at a time to `createCodexJsonlParser().pushLine()`.
- Produces: Usage events beginning only after `inter_agent_communication_metadata.trigger_turn` for subagent rollouts.

- [x] **Step 1: Add minimal subagent replay state**

Track whether the first session metadata identifies a subagent, retain its unique `payload.id`, and suppress token event emission until the trigger-turn marker. Continue updating model and cumulative usage state while suppressing replayed rows.

- [x] **Step 2: Run the focused test**

Run: `npm test -- test/codex-parser.test.ts`

Expected: PASS.

- [x] **Step 3: Run the complete automated suite**

Run: `npm test && npm run typecheck && npm run build`

Expected: 0 failures and exit code 0 for all commands.

### Task 3: Validate against real local Codex history and commit

**Files:**
- Read only: `/Users/qykong/.codex/sessions/**/rollout-*.jsonl`
- Commit: `src/sources/codex.ts`, `test/codex-parser.test.ts`, and this plan.

**Interfaces:**
- Consumes: `collectLocalUsage()` and the local July 2026 Codex rollout corpus.
- Produces: Before/after daily totals demonstrating that replay inflation is removed without deleting real subagent usage.

- [x] **Step 1: Build the patched collector**

Run: `npm run build`

Expected: exit code 0.

- [x] **Step 2: Recompute July 12 locally**

Run a read-only Node script importing `dist/file-scan.js`, aggregate events for `2026-07-12T00:00:00Z` through `2026-07-13T00:00:00Z`, and report totals by agent and session.

Expected: the previous `44,952,517,655`-token spike is removed; the former parent session no longer contributes replayed subagent history.

- [x] **Step 3: Review and commit**

Run: `git diff --check && git status --short && git diff`

Then commit with: `git commit -m "fix: ignore inherited Codex subagent replay usage"`

import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { ACCOUNTING_REVISION, collectCoverage, coverageFingerprint } from "../src/sync-coverage.js";
import type { UsageEvent } from "../src/types.js";

function event(file: string, tokens: number): UsageEvent {
  return { agent: "codex", model: "gpt-6.1-sol", sourcePath: file, sessionId: "test", timestamp: "2026-10-22T00:01:00Z",
    bucketStart: "2026-10-22T00:00:00.000Z", inputTokens: tokens, cachedInputTokens: 0, outputTokens: 0,
    reasoningOutputTokens: 0, cacheCreationTokens: 0, totalTokens: tokens };
}
describe("source contribution coverage", () => {
  it("hashes intact bytes, preserves zero-event day associations and detects rewritten prefixes", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "tokenflow-proof-"));
    const file = path.join(home, "usage.jsonl");
    try {
      await fs.writeFile(file, "old logs\n");
      const first = await collectCoverage([event(file, 100)], [file], { revision:0, scopes:[] }, [], home);
      expect(first[0].sources[0].digest).toBe(createHash("sha256").update("old logs\n").digest("hex"));
      expect(first[0].sources[0].daily?.[0].total_tokens).toBe(100);
      const state = { revision:ACCOUNTING_REVISION, scopes:first };
      const unchanged = await collectCoverage([event(file, 100)], [file], state, [], home);
      expect(coverageFingerprint(unchanged[0])).toBe(coverageFingerprint(first[0]));
      expect(unchanged[0].sources[0]).toMatchObject({ bytes: 9, prefix_bytes: 9, prefix_digest: first[0].sources[0].digest });
      await fs.appendFile(file, "more logs\n");
      const appended = await collectCoverage([event(file, 200)], [file], state, [], home);
      expect(appended[0].sources[0].prefix_digest).toBe(first[0].sources[0].digest);
      const zero = await collectCoverage([], [file], state, [], home);
      expect(zero[0].sources[0].daily).toEqual([]);
      await fs.writeFile(file, "different longer logs\n");
      const rewritten = await collectCoverage([event(file, 20)], [file], state, [], home);
      expect(rewritten[0].sources[0].prefix_digest).not.toBe(first[0].sources[0].digest);
      await fs.unlink(file);
      expect(await collectCoverage([], [], state, [], home)).toEqual([]);
    } finally { await fs.rm(home, { recursive:true, force:true }); }
  });
});

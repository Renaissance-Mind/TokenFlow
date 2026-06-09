import { describe, expect, it } from "vitest";
import { aggregateEvents } from "../src/usage-buckets.js";

describe("usage buckets", () => {
  it("aggregates by agent, model, and half-hour bucket with computed cost", () => {
    const buckets = aggregateEvents([
      {
        agent: "codex",
        model: "gpt-5.2-codex",
        sessionId: "s1",
        sourcePath: "/a.jsonl",
        timestamp: "2026-06-09T01:05:00.000Z",
        bucketStart: "2026-06-09T01:00:00.000Z",
        inputTokens: 100,
        cachedInputTokens: 20,
        outputTokens: 10,
        reasoningOutputTokens: 0,
        cacheCreationTokens: 0,
        totalTokens: 130,
      },
      {
        agent: "codex",
        model: "gpt-5.2-codex",
        sessionId: "s2",
        sourcePath: "/b.jsonl",
        timestamp: "2026-06-09T01:25:00.000Z",
        bucketStart: "2026-06-09T01:00:00.000Z",
        inputTokens: 50,
        cachedInputTokens: 10,
        outputTokens: 20,
        reasoningOutputTokens: 5,
        cacheCreationTokens: 0,
        totalTokens: 85,
      },
    ]);

    expect(buckets).toHaveLength(1);
    expect(buckets[0]).toMatchObject({
      agent: "codex",
      model: "gpt-5.2-codex",
      bucketStart: "2026-06-09T01:00:00.000Z",
      inputTokens: 150,
      cachedInputTokens: 30,
      outputTokens: 30,
      reasoningOutputTokens: 5,
      totalTokens: 215,
    });
    expect(buckets[0].cost.totalUsd).toMatch(/^\d+\.\d{6}$/);
  });
});

import { describe, expect, it } from "vitest";
import { aggregateEvents } from "../src/usage-buckets.js";

describe("usage buckets", () => {
  it("aggregates by UTC day, agent, and model with cached input priced separately", () => {
    const buckets = aggregateEvents(
      [
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
      {
        agent: "codex",
        model: "gpt-5.4",
        sessionId: "s3",
        sourcePath: "/c.jsonl",
        timestamp: "2026-06-09T23:15:00.000Z",
        bucketStart: "2026-06-09T23:00:00.000Z",
        inputTokens: 11,
        cachedInputTokens: 0,
        outputTokens: 7,
        reasoningOutputTokens: 0,
        cacheCreationTokens: 0,
        totalTokens: 18,
      },
    ],
      [
        {
          modelId: "gpt-5.2-codex",
          displayName: "GPT-5.2 Codex",
          inputUsdPerMillion: "1",
          outputUsdPerMillion: "2",
          cacheReadUsdPerMillion: "0.5",
          cacheCreationUsdPerMillion: "3",
        },
      ],
    );

    expect(buckets).toHaveLength(2);
    expect(buckets[0]).toMatchObject({
      agent: "codex",
      model: "gpt-5.2-codex",
      bucketStart: "2026-06-09T00:00:00.000Z",
      inputTokens: 150,
      cachedInputTokens: 30,
      outputTokens: 30,
      reasoningOutputTokens: 5,
      totalTokens: 215,
      cost: {
        inputUsd: "0.000120",
        outputUsd: "0.000070",
        cacheReadUsd: "0.000015",
        totalUsd: "0.000205",
      },
    });
    expect(buckets[0].pricingStatus).toBe("priced");
    expect(buckets[1]).toMatchObject({
      agent: "codex",
      model: "gpt-5.4",
      bucketStart: "2026-06-09T00:00:00.000Z",
      totalTokens: 18,
    });
  });

  it("marks unknown model buckets as unpriced instead of silently treating cost as accurate", () => {
    const buckets = aggregateEvents([
      {
        agent: "codex",
        model: "unknown-local-model",
        sessionId: "s1",
        sourcePath: "/a.jsonl",
        timestamp: "2026-06-09T01:05:00.000Z",
        bucketStart: "2026-06-09T01:00:00.000Z",
        inputTokens: 100,
        cachedInputTokens: 0,
        outputTokens: 10,
        reasoningOutputTokens: 0,
        cacheCreationTokens: 0,
        totalTokens: 110,
      },
    ]);

    expect(buckets[0]).toMatchObject({
      model: "unknown-local-model",
      pricingStatus: "unpriced",
      cost: {
        totalUsd: "0.000000",
      },
    });
  });
});

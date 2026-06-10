import { describe, expect, it } from "vitest";
import { aggregateEvents } from "../src/usage-buckets.js";

describe("usage buckets", () => {
  it("aggregates by half-hour bucket, agent, and model with cached input priced separately", () => {
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
      bucketStart: "2026-06-09T01:00:00.000Z",
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
      bucketStart: "2026-06-09T23:00:00.000Z",
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

  it("prices buckets by pricingModel while preserving the displayed model", () => {
    const buckets = aggregateEvents([
      {
        agent: "kimi",
        model: "kimi-for-coding",
        pricingModel: "kimi-k2.6",
        sessionId: "s1",
        sourcePath: "/wire.jsonl",
        timestamp: "2026-04-21T01:05:00.000Z",
        bucketStart: "2026-04-21T01:00:00.000Z",
        inputTokens: 1_000_000,
        cachedInputTokens: 0,
        outputTokens: 1_000_000,
        reasoningOutputTokens: 0,
        cacheCreationTokens: 0,
        totalTokens: 2_000_000,
      },
    ]);

    expect(buckets[0]).toMatchObject({
      model: "kimi-for-coding",
      pricingModel: "kimi-k2.6",
      pricingStatus: "priced",
      cost: {
        inputUsd: "0.950000",
        outputUsd: "4.000000",
        totalUsd: "4.950000",
      },
    });
  });

  it("uses recorded costs when a source provides authoritative billing totals", () => {
    const buckets = aggregateEvents([
      {
        agent: "opencode",
        model: "gpt-5.2-codex",
        sessionId: "s1",
        sourcePath: "/opencode.db",
        timestamp: "2026-06-09T01:05:00.000Z",
        bucketStart: "2026-06-09T01:00:00.000Z",
        inputTokens: 1_000_000,
        cachedInputTokens: 0,
        outputTokens: 1_000_000,
        reasoningOutputTokens: 0,
        cacheCreationTokens: 0,
        totalTokens: 2_000_000,
        recordedCostUsd: "0.123456",
      },
    ]);

    expect(buckets[0]).toMatchObject({
      pricingStatus: "priced",
      cost: {
        inputUsd: "0.000000",
        outputUsd: "0.000000",
        cacheReadUsd: "0.000000",
        cacheCreationUsd: "0.000000",
        totalUsd: "0.123456",
      },
    });
  });
});

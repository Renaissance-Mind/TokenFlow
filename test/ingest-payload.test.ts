import { describe, expect, it } from "vitest";
import { toIngestPayload, toUsageSnapshotPayload, unknownReplacementScopesForBuckets } from "../src/ingest-payload.js";
import type { UsageBucket } from "../src/types.js";

describe("ingest payload", () => {
  it("serializes buckets in the server contract shape", () => {
    const payload = toIngestPayload([
      {
        agent: "codex",
        model: "gpt-5.2-codex",
        bucketStart: "2026-06-09T01:00:00.000Z",
        inputTokens: 10,
        cachedInputTokens: 3,
        outputTokens: 2,
        reasoningOutputTokens: 1,
        cacheCreationTokens: 0,
        totalTokens: 16,
        cost: {
          inputUsd: "0.000012",
          outputUsd: "0.000040",
          cacheReadUsd: "0.000001",
          cacheCreationUsd: "0.000000",
          totalUsd: "0.000053",
        },
        pricingStatus: "unpriced",
      },
    ]);

    expect(payload).toEqual({
      bucket_granularity: "half_hour",
      hourly: [
        {
          agent: "codex",
          model: "gpt-5.2-codex",
          granularity: "half_hour",
          bucket_start: "2026-06-09T01:00:00.000Z",
          input_tokens: 10,
          cached_input_tokens: 3,
          output_tokens: 2,
          reasoning_output_tokens: 1,
          cache_creation_tokens: 0,
          total_tokens: 16,
          input_cost_usd: "0.000012",
          output_cost_usd: "0.000040",
          cache_read_cost_usd: "0.000001",
          cache_creation_cost_usd: "0.000000",
          total_cost_usd: "0.000053",
          pricing_status: "unpriced",
        },
      ],
    });
  });

  it("marks known Codex day buckets as safe unknown replacements", () => {
    const scopes = unknownReplacementScopesForBuckets([
      bucket("codex", "gpt-5.5", "2026-05-13T00:00:00.000Z"),
      bucket("claude", "claude-sonnet-4", "2026-05-13T00:00:00.000Z"),
    ]);

    expect(scopes).toEqual([{ agent: "codex", bucket_start: "2026-05-13T00:00:00.000Z", granularity: "half_hour" }]);
    expect(toIngestPayload([bucket("codex", "gpt-5.5", "2026-05-13T00:00:00.000Z")], { replaceUnknownBuckets: scopes })).toMatchObject({
      replace_unknown_buckets: [{ agent: "codex", bucket_start: "2026-05-13T00:00:00.000Z", granularity: "half_hour" }],
    });
  });

  it("does not replace unknown buckets when the same Codex day still contains unresolved unknown usage", () => {
    expect(
      unknownReplacementScopesForBuckets([
        bucket("codex", "gpt-5.5", "2026-05-13T00:00:00.000Z"),
        bucket("codex", "unknown", "2026-05-13T00:00:00.000Z"),
      ]),
    ).toEqual([]);
  });

  it("groups half-hour buckets into daily snapshot records with slot details", () => {
    const payload = toUsageSnapshotPayload(
      [
        bucket("codex", "gpt-5.5", "2026-06-09T01:00:00.000Z"),
        bucket("codex", "gpt-5.5", "2026-06-09T01:30:00.000Z"),
      ],
      { deviceName: "Work Mac", platform: "darwin" },
    );

    expect(payload).toMatchObject({
      device_name: "Work Mac",
      platform: "darwin",
      snapshot_version: "daily-v1",
      daily: [
        {
          day: "2026-06-09",
          bucket_start: "2026-06-09T00:00:00.000Z",
          agent: "codex",
          model: "gpt-5.5",
          total_tokens: 32,
          total_cost_usd: "0.000106",
          unpriced_buckets: 0,
          slots: [
            { bucket_start: "2026-06-09T01:00:00.000Z", total_tokens: 16 },
            { bucket_start: "2026-06-09T01:30:00.000Z", total_tokens: 16 },
          ],
        },
      ],
    });
  });
});

function bucket(agent: UsageBucket["agent"], model: string, bucketStart: string): UsageBucket {
  return {
    agent,
    model,
    bucketStart,
    inputTokens: 10,
    cachedInputTokens: 3,
    outputTokens: 2,
    reasoningOutputTokens: 1,
    cacheCreationTokens: 0,
    totalTokens: 16,
    cost: {
      inputUsd: "0.000012",
      outputUsd: "0.000040",
      cacheReadUsd: "0.000001",
      cacheCreationUsd: "0.000000",
      totalUsd: "0.000053",
    },
    pricingStatus: "priced",
  };
}

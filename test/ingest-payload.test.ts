import { describe, expect, it } from "vitest";
import { toIngestPayload } from "../src/ingest-payload.js";

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
      hourly: [
        {
          agent: "codex",
          model: "gpt-5.2-codex",
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
});

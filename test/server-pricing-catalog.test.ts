import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  parsePricingCatalog,
  readPricingCatalog,
  writePricingCatalog,
} from "../src/server-pricing-catalog.js";
import { aggregateEvents } from "../src/usage-buckets.js";
import { toUsageSnapshotPayload } from "../src/ingest-payload.js";

const catalog = {
  version: "ccusage-test",
  profiles: [
    {
      modelId: "gpt-6.1-sol",
      displayName: "GPT-6.1 Sol",
      inputUsdPerMillion: "2",
      outputUsdPerMillion: "10",
      cacheReadUsdPerMillion: "0.1",
      cacheCreationUsdPerMillion: "2.5",
      inputAbove200kUsdPerMillion: "4",
      outputAbove200kUsdPerMillion: "15",
      cacheReadAbove200kUsdPerMillion: "0.2",
      cacheCreationAbove200kUsdPerMillion: "5",
      longContextThresholdTokens: 272_000,
    },
  ],
};

describe("server pricing catalog", () => {
  it("classifies long requests for a model absent from the collector's bundled table", () => {
    const pricing = parsePricingCatalog(catalog);
    const buckets = aggregateEvents(
      [
        {
          agent: "codex",
          model: "gpt-6.1-sol",
          sessionId: "s",
          sourcePath: "rollout.jsonl",
          timestamp: "2026-10-03T00:00:00Z",
          bucketStart: "2026-10-03T00:00:00.000Z",
          inputTokens: 300_000,
          cachedInputTokens: 0,
          outputTokens: 10_000,
          reasoningOutputTokens: 0,
          cacheCreationTokens: 0,
          totalTokens: 310_000,
        },
      ],
      pricing.profiles,
    );
    expect(buckets[0]).toMatchObject({
      longContextInputTokens: 300_000,
      cost: { totalUsd: "1.350000" },
    });
    expect(toUsageSnapshotPayload(buckets).daily[0].slots[0]).toMatchObject({
      long_context_input_tokens: 300_000,
      long_context_output_tokens: 10_000,
    });
    expect(() =>
      parsePricingCatalog({
        ...catalog,
        profiles: [{ ...catalog.profiles[0], inputUsdPerMillion: "NaN" }],
      }),
    ).toThrow("Invalid server pricing rate");
  });

  it("caches validated data for only the configured server", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "tokenflow-catalog-"));
    try {
      await writePricingCatalog("https://server-a.example", catalog, home);
      expect(
        await readPricingCatalog("https://server-a.example", home),
      ).toEqual(catalog);
      expect(
        await readPricingCatalog("https://server-b.example", home),
      ).toBeNull();
    } finally {
      await fs.rm(home, { recursive: true, force: true });
    }
  });
});

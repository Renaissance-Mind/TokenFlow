import { describe, expect, it } from "vitest";

import {
  emptySyncState,
  markSyncPlanUploaded,
  planIncrementalSync,
} from "../src/sync-state.js";
import type { UsageBucket } from "../src/types.js";

describe("incremental sync state", () => {
  it("uploads only new or changed half-hour buckets", () => {
    const first = bucket("2026-06-09T01:00:00.000Z", 16);
    const second = bucket("2026-06-09T01:30:00.000Z", 20);
    const uploaded = markSyncPlanUploaded(
      emptySyncState(),
      { buckets: [first], replaceDailyBuckets: [], replaceUnknownBuckets: [] },
      "2026-06-09T02:00:00.000Z",
    );

    const plan = planIncrementalSync([first, second], uploaded, {
      maxBuckets: 100,
    });

    expect(plan.buckets.map((item) => item.bucketStart)).toEqual(["2026-06-09T01:30:00.000Z"]);
  });

  it("does not replace a legacy daily bucket until every local bucket for that day has uploaded", () => {
    const first = bucket("2026-06-09T01:00:00.000Z", 16);
    const second = bucket("2026-06-09T01:30:00.000Z", 20);

    const plan = planIncrementalSync([first, second], emptySyncState(), {
      maxBuckets: 1,
    });

    expect(plan.buckets).toHaveLength(1);
    expect(plan.replaceDailyBuckets).toEqual([]);
  });

  it("emits a daily replacement scope when the selected upload completes that day", () => {
    const first = bucket("2026-06-09T01:00:00.000Z", 16);
    const second = bucket("2026-06-09T01:30:00.000Z", 20);
    const uploaded = markSyncPlanUploaded(
      emptySyncState(),
      { buckets: [first], replaceDailyBuckets: [], replaceUnknownBuckets: [] },
      "2026-06-09T02:00:00.000Z",
    );

    const plan = planIncrementalSync([first, second], uploaded, {
      maxBuckets: 100,
    });

    expect(plan.buckets.map((item) => item.bucketStart)).toEqual(["2026-06-09T01:30:00.000Z"]);
    expect(plan.replaceDailyBuckets).toEqual([
      {
        agent: "codex",
        model: "gpt-5.2-codex",
        bucket_start: "2026-06-09T00:00:00.000Z",
      },
    ]);
  });

  it("retries a completed daily replacement scope until it is recorded as uploaded", () => {
    const first = bucket("2026-06-09T01:00:00.000Z", 16);
    const second = bucket("2026-06-09T01:30:00.000Z", 20);
    const uploadedBuckets = markSyncPlanUploaded(
      emptySyncState(),
      { buckets: [first, second], replaceDailyBuckets: [], replaceUnknownBuckets: [] },
      "2026-06-09T02:00:00.000Z",
    );

    const retryPlan = planIncrementalSync([first, second], uploadedBuckets, {
      maxBuckets: 100,
    });

    expect(retryPlan.buckets).toEqual([]);
    expect(retryPlan.replaceDailyBuckets).toEqual([
      {
        agent: "codex",
        model: "gpt-5.2-codex",
        bucket_start: "2026-06-09T00:00:00.000Z",
      },
    ]);

    const completed = markSyncPlanUploaded(uploadedBuckets, retryPlan, "2026-06-09T02:05:00.000Z");
    expect(planIncrementalSync([first, second], completed, { maxBuckets: 100 }).replaceDailyBuckets).toEqual([]);
  });
});

function bucket(bucketStart: string, totalTokens: number): UsageBucket {
  return {
    agent: "codex",
    model: "gpt-5.2-codex",
    bucketStart,
    inputTokens: totalTokens - 6,
    cachedInputTokens: 3,
    outputTokens: 2,
    reasoningOutputTokens: 1,
    cacheCreationTokens: 0,
    totalTokens,
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

import { calculateCost, resolvePricing } from "./pricing.js";
import type { CostBreakdown, UsageBucket, UsageEvent, UsageTotals } from "./types.js";

const ZERO_COST: CostBreakdown = {
  inputUsd: "0.000000",
  outputUsd: "0.000000",
  cacheReadUsd: "0.000000",
  cacheCreationUsd: "0.000000",
  totalUsd: "0.000000",
};

export function aggregateEvents(events: UsageEvent[]): UsageBucket[] {
  const buckets = new Map<string, UsageBucket>();

  for (const event of events) {
    const key = `${event.agent}|${event.model}|${event.bucketStart}`;
    const bucket =
      buckets.get(key) ||
      ({
        agent: event.agent,
        model: event.model,
        bucketStart: event.bucketStart,
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningOutputTokens: 0,
        cacheCreationTokens: 0,
        totalTokens: 0,
        cost: ZERO_COST,
      } satisfies UsageBucket);

    addTotals(bucket, event);
    bucket.cost = calculateBucketCost(bucket);
    buckets.set(key, bucket);
  }

  return Array.from(buckets.values()).sort((a, b) =>
    `${a.bucketStart}|${a.agent}|${a.model}`.localeCompare(`${b.bucketStart}|${b.agent}|${b.model}`),
  );
}

function calculateBucketCost(bucket: UsageBucket): CostBreakdown {
  const pricing = resolvePricing(bucket.model);
  if (!pricing) return ZERO_COST;
  return calculateCost(bucket.agent, bucket, pricing);
}

function addTotals(target: UsageTotals, delta: UsageTotals): void {
  target.inputTokens += delta.inputTokens;
  target.cachedInputTokens += delta.cachedInputTokens;
  target.outputTokens += delta.outputTokens;
  target.reasoningOutputTokens += delta.reasoningOutputTokens;
  target.cacheCreationTokens += delta.cacheCreationTokens;
  target.totalTokens += delta.totalTokens;
}

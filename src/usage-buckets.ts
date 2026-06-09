import { calculateCost, resolvePricing } from "./pricing.js";
import type { CostBreakdown, PricingProfile, UsageBucket, UsageEvent, UsageTotals } from "./types.js";

const ZERO_COST: CostBreakdown = {
  inputUsd: "0.000000",
  outputUsd: "0.000000",
  cacheReadUsd: "0.000000",
  cacheCreationUsd: "0.000000",
  totalUsd: "0.000000",
};

export function aggregateEvents(events: UsageEvent[], pricingProfiles: PricingProfile[] = []): UsageBucket[] {
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
        pricingStatus: "unpriced",
      } satisfies UsageBucket);

    addTotals(bucket, event);
    const pricing = calculateBucketCost(bucket, pricingProfiles);
    bucket.cost = pricing.cost;
    bucket.pricingStatus = pricing.status;
    buckets.set(key, bucket);
  }

  return Array.from(buckets.values()).sort((a, b) =>
    `${a.bucketStart}|${a.agent}|${a.model}`.localeCompare(`${b.bucketStart}|${b.agent}|${b.model}`),
  );
}

function calculateBucketCost(
  bucket: UsageBucket,
  pricingProfiles: PricingProfile[],
): { cost: CostBreakdown; status: "priced" | "unpriced" } {
  const pricing = resolvePricing(bucket.model, pricingProfiles);
  if (!pricing) return { cost: ZERO_COST, status: "unpriced" };
  return { cost: calculateCost(bucket.agent, bucket, pricing), status: "priced" };
}

function addTotals(target: UsageTotals, delta: UsageTotals): void {
  target.inputTokens += delta.inputTokens;
  target.cachedInputTokens += delta.cachedInputTokens;
  target.outputTokens += delta.outputTokens;
  target.reasoningOutputTokens += delta.reasoningOutputTokens;
  target.cacheCreationTokens += delta.cacheCreationTokens;
  target.totalTokens += delta.totalTokens;
}

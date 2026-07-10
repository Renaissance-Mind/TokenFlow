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
    const bucketStart = event.bucketStart;
    const key = `${event.agent}|${event.model}|${bucketStart}`;
    const bucket =
      buckets.get(key) ||
      ({
        agent: event.agent,
        model: event.model,
        pricingModel: event.pricingModel,
        costMultiplier: event.costMultiplier,
        bucketStart,
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningOutputTokens: 0,
        cacheCreationTokens: 0,
        cacheCreation5mTokens: 0,
        cacheCreation1hTokens: 0,
        extraTotalTokens: 0,
        longContextInputTokens: 0,
        longContextCachedInputTokens: 0,
        longContextOutputTokens: 0,
        longContextReasoningOutputTokens: 0,
        longContextCacheCreationTokens: 0,
        longContextCacheCreation5mTokens: 0,
        longContextCacheCreation1hTokens: 0,
        longContextExtraTotalTokens: 0,
        totalTokens: 0,
        cost: ZERO_COST,
        pricingStatus: "unpriced",
      } satisfies UsageBucket);

    addTotals(bucket, event);
    addLongContextTotals(bucket, event, pricingProfiles);
    bucket.pricingModel ||= event.pricingModel;
    bucket.costMultiplier ||= event.costMultiplier;
    bucket.recordedCostUsd = addUsdStrings(bucket.recordedCostUsd, event.recordedCostUsd);
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
  if (bucket.recordedCostUsd) {
    return {
      cost: {
        inputUsd: "0.000000",
        outputUsd: "0.000000",
        cacheReadUsd: "0.000000",
        cacheCreationUsd: "0.000000",
        totalUsd: bucket.recordedCostUsd,
      },
      status: "priced",
    };
  }
  const pricing = resolvePricing(bucket.pricingModel || bucket.model, pricingProfiles);
  if (!pricing) return { cost: ZERO_COST, status: "unpriced" };
  return { cost: calculateCost(bucket.agent, bucket, pricing, bucket.costMultiplier || "1"), status: "priced" };
}

function addTotals(target: UsageTotals, delta: UsageTotals): void {
  target.inputTokens += delta.inputTokens;
  target.cachedInputTokens += delta.cachedInputTokens;
  target.outputTokens += delta.outputTokens;
  target.reasoningOutputTokens += delta.reasoningOutputTokens;
  target.cacheCreationTokens += delta.cacheCreationTokens;
  target.cacheCreation5mTokens = (target.cacheCreation5mTokens || 0) + (delta.cacheCreation5mTokens || 0);
  target.cacheCreation1hTokens = (target.cacheCreation1hTokens || 0) + (delta.cacheCreation1hTokens || 0);
  target.extraTotalTokens = (target.extraTotalTokens || 0) + (delta.extraTotalTokens || 0);
  target.longContextInputTokens = (target.longContextInputTokens || 0) + (delta.longContextInputTokens || 0);
  target.longContextCachedInputTokens =
    (target.longContextCachedInputTokens || 0) + (delta.longContextCachedInputTokens || 0);
  target.longContextOutputTokens = (target.longContextOutputTokens || 0) + (delta.longContextOutputTokens || 0);
  target.longContextReasoningOutputTokens =
    (target.longContextReasoningOutputTokens || 0) + (delta.longContextReasoningOutputTokens || 0);
  target.longContextCacheCreationTokens =
    (target.longContextCacheCreationTokens || 0) + (delta.longContextCacheCreationTokens || 0);
  target.longContextCacheCreation5mTokens =
    (target.longContextCacheCreation5mTokens || 0) + (delta.longContextCacheCreation5mTokens || 0);
  target.longContextCacheCreation1hTokens =
    (target.longContextCacheCreation1hTokens || 0) + (delta.longContextCacheCreation1hTokens || 0);
  target.longContextExtraTotalTokens =
    (target.longContextExtraTotalTokens || 0) + (delta.longContextExtraTotalTokens || 0);
  target.totalTokens += delta.totalTokens;
}

function addLongContextTotals(
  target: UsageTotals,
  event: UsageEvent,
  pricingProfiles: PricingProfile[],
): void {
  if (event.longContextInputTokens !== undefined) return;
  const pricing = resolvePricing(event.pricingModel || event.model, pricingProfiles);
  if (!pricing?.longContextThresholdTokens || event.inputTokens <= pricing.longContextThresholdTokens) return;

  target.longContextInputTokens = (target.longContextInputTokens || 0) + event.inputTokens;
  target.longContextCachedInputTokens = (target.longContextCachedInputTokens || 0) + event.cachedInputTokens;
  target.longContextOutputTokens = (target.longContextOutputTokens || 0) + event.outputTokens;
  target.longContextReasoningOutputTokens =
    (target.longContextReasoningOutputTokens || 0) + event.reasoningOutputTokens;
  target.longContextCacheCreationTokens =
    (target.longContextCacheCreationTokens || 0) + event.cacheCreationTokens;
  target.longContextCacheCreation5mTokens =
    (target.longContextCacheCreation5mTokens || 0) + (event.cacheCreation5mTokens || 0);
  target.longContextCacheCreation1hTokens =
    (target.longContextCacheCreation1hTokens || 0) + (event.cacheCreation1hTokens || 0);
  target.longContextExtraTotalTokens = (target.longContextExtraTotalTokens || 0) + (event.extraTotalTokens || 0);
}
function addUsdStrings(left: string | undefined, right: string | undefined): string | undefined {
  if (!right) return left;
  if (!left) return normalizeUsdString(right);
  return formatMicroUsd(parseUsdToMicro(left) + parseUsdToMicro(right));
}

function normalizeUsdString(value: string): string {
  return formatMicroUsd(parseUsdToMicro(value));
}

function parseUsdToMicro(value: string): bigint {
  const trimmed = value.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) throw new Error(`Invalid USD value: ${value}`);
  const [whole, fraction = ""] = trimmed.split(".");
  return BigInt(whole) * 1_000_000n + BigInt(`${fraction}000000`.slice(0, 6));
}

function formatMicroUsd(value: bigint): string {
  const whole = value / 1_000_000n;
  const fraction = (value % 1_000_000n).toString().padStart(6, "0");
  return `${whole}.${fraction}`;
}
